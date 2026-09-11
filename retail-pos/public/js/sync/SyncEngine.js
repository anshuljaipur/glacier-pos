/**
 * js/sync/SyncEngine.js
 * Manages bidirectional diffs, conflict resolution, and ledger reconciliations
 */

export class SyncEngine {
  constructor(firestoreDb, appsScriptUrl, authSecret) {
    this.db = firestoreDb;
    this.appsScriptUrl = appsScriptUrl;
    this.authSecret = authSecret;
  }

  /**
   * Generates diff preview without committing mutations
   */
  async generateDiffPreview() {
    // 1. Fetch remote Google Sheets records via Apps Script Webhook
    const sheetResponse = await fetch(`${this.appsScriptUrl}?authKey=${this.authSecret}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'GET_SHEET_DATA' })
    });
    const sheetResult = await sheetResponse.json();
    if (!sheetResult.success) throw new Error(sheetResult.error);

    const sheetRows = sheetResult.rows;
    const sheetHeaders = sheetResult.headers;

    // 2. Fetch all Firebase active/inactive products
    const fbSnap = await this.db.collection('products').get();
    const fbProducts = new Map();
    fbSnap.docs.forEach(doc => fbProducts.set(doc.id, { ...doc.data() }));

    const preview = {
      sheetToFirebase: [],
      firebaseToSheet: [],
      conflicts: [],
      newColumns: []
    };

    const seenFirebasePids = new Set();

    // 3. Process Sheet -> Firebase direction
    for (const sRow of sheetRows) {
      const pid = String(sRow['Product ID'] || '').trim();

      if (!pid) {
        // Unidentified item in sheet -> Needs creation
        preview.sheetToFirebase.push({
          action: 'CREATE',
          source: 'GOOGLE_SHEET',
          productName: sRow['Item Name'],
          data: sRow
        });
        continue;
      }

      seenFirebasePids.add(pid);
      const fbProd = fbProducts.get(pid);

      if (!fbProd) {
        preview.sheetToFirebase.push({
          action: 'CREATE_WITH_ID',
          productId: pid,
          source: 'GOOGLE_SHEET',
          productName: sRow['Item Name'],
          data: sRow
        });
        continue;
      }

      // Check for concurrent modification conflict
      const fbModified = new Date(fbProd.syncMetadata.lastFirebaseModifiedAt || 0).getTime();
      const sheetModified = new Date(sRow['Updated Date'] || 0).getTime();
      const lastSynced = new Date(fbProd.syncMetadata.lastSyncedAt || 0).getTime();

      const fbHasLocalChanges = fbModified > lastSynced;
      const sheetHasChanges = sRow._contentHash !== fbProd.syncMetadata.contentHash;

      if (fbHasLocalChanges && sheetHasChanges) {
        // True Conflict: both modified concurrently since last sync
        preview.conflicts.push({
          productId: pid,
          productName: fbProd.itemName,
          sheetData: sRow,
          firebaseData: fbProd,
          fieldsChanged: this._getChangedFields(fbProd, sRow)
        });
      } else if (sheetHasChanges) {
        preview.sheetToFirebase.push({
          action: 'UPDATE',
          productId: pid,
          productName: fbProd.itemName,
          source: 'GOOGLE_SHEET',
          diff: this._getChangedFields(fbProd, sRow),
          data: sRow
        });
      } else if (fbHasLocalChanges) {
        preview.firebaseToSheet.push({
          action: 'UPDATE',
          productId: pid,
          productName: fbProd.itemName,
          source: 'FIREBASE',
          diff: this._getChangedFields(fbProd, sRow),
          data: fbProd
        });
      }
    }

    // 4. Check for products present in Firebase but absent in Google Sheet
    for (const [pid, fbProd] of fbProducts.entries()) {
      if (!seenFirebasePids.has(pid)) {
        preview.firebaseToSheet.push({
          action: 'APPEND_TO_SHEET',
          productId: pid,
          productName: fbProd.itemName,
          source: 'FIREBASE',
          data: fbProd
        });
      }
    }

    return preview;
  }

  /**
   * Applies approved diffs, records stock ledger adjustments, and writes sync logs
   */
  async executeSync(previewItems, resolvedConflicts = [], userId = 'SYSTEM') {
    const batch = this.db.batch();
    const nowTimestamp = new Date().toISOString();
    const syncSummary = { added: 0, updated: 0, stockAdjusted: 0, errors: [] };

    // Apply Sheet -> Firebase mutations
    for (const item of previewItems.sheetToFirebase) {
      try {
        if (item.action === 'CREATE' || item.action === 'CREATE_WITH_ID') {
          const newDocRef = item.action === 'CREATE_WITH_ID' 
            ? this.db.collection('products').doc(item.productId) 
            : this.db.collection('products').doc();

          const newPid = item.productId || `PROD-${Math.floor(100000 + Math.random() * 900000)}`;
          const initialStock = Number(item.data['Current Stock']) || 0;

          const productData = {
            productId: newPid,
            barcode: String(item.data['Barcode'] || ''),
            itemName: String(item.data['Item Name'] || 'Unnamed Product'),
            brandName: String(item.data['Brand'] || ''),
            categoryName: String(item.data['Category'] || ''),
            sellingPrice: Number(item.data['Selling Price']) || 0,
            mrp: Number(item.data['MRP']) || 0,
            gstRate: Number(item.data['GST %']) || 0,
            hsnCode: String(item.data['HSN'] || ''),
            currentStock: initialStock,
            status: item.data['Status'] || 'active',
            syncMetadata: {
              contentHash: item.data._contentHash,
              lastSyncedAt: nowTimestamp,
              lastSheetModifiedAt: nowTimestamp,
              lastFirebaseModifiedAt: nowTimestamp,
              lastModifiedSource: 'GOOGLE_SHEET'
            },
            createdAt: nowTimestamp,
            updatedAt: nowTimestamp
          };

          batch.set(newDocRef, productData);

          // Record Opening Stock in Ledger
          if (initialStock > 0) {
            const ledgerRef = this.db.collection('stockLedger').doc();
            batch.set(ledgerRef, {
              ledgerId: ledgerRef.id,
              timestamp: nowTimestamp,
              productId: newPid,
              transactionType: 'OPENING_STOCK',
              referenceId: 'SHEET_SYNC',
              quantityChange: initialStock,
              previousStock: 0,
              newStock: initialStock,
              source: 'GOOGLE_SHEET',
              userId,
              remarks: 'Initial inventory import from Google Sheet'
            });
          }
          syncSummary.added++;

        } else if (item.action === 'UPDATE') {
          const docRef = this.db.collection('products').doc(item.productId);
          const updatePayload = {
            updatedAt: nowTimestamp,
            'syncMetadata.contentHash': item.data._contentHash,
            'syncMetadata.lastSyncedAt': nowTimestamp,
            'syncMetadata.lastSheetModifiedAt': nowTimestamp,
            'syncMetadata.lastModifiedSource': 'GOOGLE_SHEET'
          };

          // Apply changed fields
          for (const [key, val] of Object.entries(item.diff)) {
            if (key === 'Current Stock') {
              const prevStock = val.oldVal;
              const nextStock = Number(val.newVal);
              const delta = nextStock - prevStock;

              if (delta !== 0) {
                updatePayload.currentStock = nextStock;
                // Add Stock Adjustment to Ledger
                const ledgerRef = this.db.collection('stockLedger').doc();
                batch.set(ledgerRef, {
                  ledgerId: ledgerRef.id,
                  timestamp: nowTimestamp,
                  productId: item.productId,
                  transactionType: 'MANUAL_ADJUSTMENT',
                  referenceId: 'SHEET_EDIT',
                  quantityChange: delta,
                  previousStock: prevStock,
                  newStock: nextStock,
                  source: 'GOOGLE_SHEET',
                  userId,
                  remarks: 'Stock adjusted manually in Google Sheet'
                });
                syncSummary.stockAdjusted++;
              }
            } else if (key === 'Selling Price') updatePayload.sellingPrice = Number(val.newVal);
            else if (key === 'MRP') updatePayload.mrp = Number(val.newVal);
            else if (key === 'Item Name') updatePayload.itemName = val.newVal;
            else if (key === 'Status') updatePayload.status = val.newVal;
          }

          batch.update(docRef, updatePayload);
          syncSummary.updated++;
        }
      } catch (err) {
        syncSummary.errors.push({ id: item.productId, error: err.message });
      }
    }

    // Commit Firestore batch
    await batch.commit();

    // Push Firebase changes to Google Sheet via Apps Script
    if (previewItems.firebaseToSheet.length > 0) {
      const sheetPayload = previewItems.firebaseToSheet.map(item => ({
        productId: item.productId,
        data: {
          'Product ID': item.productId,
          'Item Name': item.data.itemName,
          'Selling Price': item.data.sellingPrice,
          'MRP': item.data.mrp,
          'Current Stock': item.data.currentStock,
          'Status': item.data.status,
          'Updated Date': nowTimestamp
        }
      }));

      await fetch(this.appsScriptUrl, {
        method: 'POST',
        body: JSON.stringify({
          authKey: this.authSecret,
          action: 'APPLY_FIREBASE_CHANGES',
          changes: sheetPayload
        })
      });
    }

    // Record immutable audit history
    await this.db.collection('syncLogs').add({
      timestamp: nowTimestamp,
      summary: syncSummary,
      performedBy: userId
    });

    return syncSummary;
  }

  _getChangedFields(fbProd, sheetRow) {
    const diff = {};
    if (fbProd.sellingPrice !== Number(sheetRow['Selling Price'])) {
      diff['Selling Price'] = { oldVal: fbProd.sellingPrice, newVal: sheetRow['Selling Price'] };
    }
    if (fbProd.mrp !== Number(sheetRow['MRP'])) {
      diff['MRP'] = { oldVal: fbProd.mrp, newVal: sheetRow['MRP'] };
    }
    if (fbProd.currentStock !== Number(sheetRow['Current Stock'])) {
      diff['Current Stock'] = { oldVal: fbProd.currentStock, newVal: sheetRow['Current Stock'] };
    }
    if (fbProd.itemName !== sheetRow['Item Name']) {
      diff['Item Name'] = { oldVal: fbProd.itemName, newVal: sheetRow['Item Name'] };
    }
    return diff;
  }
}
