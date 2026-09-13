const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { hashSyncedFields } = require('./lib/hash');
const { allocateProductId } = require('./lib/idAllocator');
const { applyStockChange } = require('./lib/stockLedger');
const { getInventoryWithHashes, applySheetWrites, writeSheetSyncLog, SYNC_SHARED_SECRET } = require('./lib/sheetsClient');
const {
  SYNCED_FIELDS, FIELD_TO_HEADER, LEDGER_CONTROLLED_FIELDS, LIST_FIELDS, normalizeValue, buildSyncSubset
} = require('./lib/syncFields');
const { REFERENCE_FIELDS, loadMasterMaps, resolveRowReferenceFields, idToName, toSheetCellValue } = require('./lib/masterResolver');

if (!admin.apps.length) admin.initializeApp();

const SYNC_ROLES = ['owner', 'manager', 'inventoryStaff'];

function requireSyncPermission(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const role = request.auth.token.role;
  if (!SYNC_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Your role does not have sync permission.');
  }
  return { uid: request.auth.uid, role };
}

function cellValue(fieldKey, value, maps) {
  return toSheetCellValue(fieldKey, value, maps, { LIST_FIELDS });
}

/**
 * Computes the full diff between the Sheet and Firestore. Shared by
 * previewSync (read-only) and syncNow (which recomputes this itself rather
 * than trusting whatever the client last saw — section 44).
 *
 * Reference fields (category/subCategory/brand/unit/supplierId) are stored
 * in Firestore as master IDs but appear in the Sheet as plain names, so the
 * Sheet's raw row.fields are resolved to IDs (masterResolver.js) before any
 * comparison happens — from that point on every field, reference or not, is
 * compared and stored the same way.
 */
async function computePreview(db) {
  const [sheetData, productsSnap, ignoredFlagsSnap, masterMaps] = await Promise.all([
    getInventoryWithHashes(),
    db.collection('products').get(),
    db.collection('syncFlags').where('status', '==', 'ignored').get(),
    loadMasterMaps(db)
  ]);

  const warnings = [];
  const ignoredIds = new Set(ignoredFlagsSnap.docs.map((d) => d.id));
  const sheetRowsById = new Map();
  const unmatchedNewRows = [];

  for (const row of sheetData.rows) {
    const { resolved, warnings: rowWarnings } = await resolveRowReferenceFields(db, masterMaps, row.fields);
    row.resolvedFields = resolved;
    row.contentHash = hashSyncedFields(buildSyncSubset(resolved));
    warnings.push(...rowWarnings);
    if (row.productId) sheetRowsById.set(row.productId, row);
    else unmatchedNewRows.push(row);
  }

  const firestoreById = new Map();
  for (const doc of productsSnap.docs) firestoreById.set(doc.id, { id: doc.id, ...doc.data() });

  const changes = [];
  const conflicts = [];
  const missingFromSheet = [];
  const newProducts = [];
  const newSheetRows = [];

  for (const [productId, row] of sheetRowsById) {
    const fsProduct = firestoreById.get(productId);
    if (!fsProduct) {
      newProducts.push({ productId, row, useGivenId: true });
      continue;
    }
    firestoreById.delete(productId);

    const lastSyncedHash = fsProduct.sync?.lastSyncedHash ?? null;
    const sheetDirty = row.contentHash !== lastSyncedHash;
    const firestoreDirty = fsProduct.sync?.contentHash !== lastSyncedHash;

    if (!sheetDirty && !firestoreDirty) continue;

    if (sheetDirty && firestoreDirty && row.contentHash !== fsProduct.sync?.contentHash) {
      const fields = [];
      for (const key of SYNCED_FIELDS) {
        const sheetVal = normalizeValue(key, row.resolvedFields[key]);
        const fsVal = normalizeValue(key, fsProduct[key]);
        if (JSON.stringify(sheetVal) !== JSON.stringify(fsVal)) {
          fields.push({
            field: key, header: FIELD_TO_HEADER[key],
            sheetValue: row.resolvedFields[key] ?? '', firebaseValue: fsProduct[key] ?? ''
          });
        }
      }
      if (fields.length) conflicts.push({ productId, itemName: fsProduct.itemName, rowIndex: row.rowIndex, fields });
      continue;
    }

    const source = sheetDirty ? 'GOOGLE_SHEET' : 'POS';
    const reference = sheetDirty ? row.resolvedFields : fsProduct;
    const other = sheetDirty ? fsProduct : row.resolvedFields;
    for (const key of SYNCED_FIELDS) {
      const newVal = normalizeValue(key, reference[key]);
      const oldVal = normalizeValue(key, other[key]);
      if (JSON.stringify(newVal) === JSON.stringify(oldVal)) continue;
      const action = LEDGER_CONTROLLED_FIELDS.includes(key) ? 'STOCK_ADJUSTMENT' : 'UPDATE';
      changes.push({ productId, itemName: fsProduct.itemName, field: key, header: FIELD_TO_HEADER[key], oldValue: oldVal, newValue: newVal, source, action, rowIndex: row.rowIndex });
    }
  }

  for (const row of unmatchedNewRows) {
    if (!row.resolvedFields.itemName) continue;
    newProducts.push({ productId: null, row, useGivenId: false });
  }

  for (const [productId, fsProduct] of firestoreById) {
    if (ignoredIds.has(productId)) continue;
    if (fsProduct.sync?.lastSyncedHash) {
      missingFromSheet.push({ productId, itemName: fsProduct.itemName, status: fsProduct.status });
    } else {
      newSheetRows.push({ productId, fsProduct });
    }
  }

  return {
    counts: {
      sheetProducts: sheetRowsById.size,
      firebaseProducts: productsSnap.size,
      pendingSheetToFirebase: changes.filter((c) => c.source === 'GOOGLE_SHEET').length + newProducts.length,
      pendingFirebaseToSheet: changes.filter((c) => c.source === 'POS').length + newSheetRows.length,
      conflicts: conflicts.length,
      missingFromSheet: missingFromSheet.length
    },
    changes, conflicts, missingFromSheet, newProducts, newSheetRows, warnings, masterMaps,
    newColumns: sheetData.newColumns || [],
    missingColumns: sheetData.missingColumns || []
  };
}

/** Converts a reference-field ID (category/brand/...) to its display name for the client preview response only — internal apply logic keeps using raw IDs. */
function humanize(value, field, maps) {
  const collectionName = REFERENCE_FIELDS[field];
  if (!collectionName) return value;
  return idToName(maps, collectionName, value) || value;
}

exports.previewSync = onCall({ secrets: [SYNC_SHARED_SECRET] }, async (request) => {
  requireSyncPermission(request);
  const db = admin.firestore();
  const preview = await computePreview(db);
  return {
    counts: preview.counts,
    changes: preview.changes.map((c) => ({ ...c, oldValue: humanize(c.oldValue, c.field, preview.masterMaps), newValue: humanize(c.newValue, c.field, preview.masterMaps) })),
    conflicts: preview.conflicts.map((c) => ({
      productId: c.productId, itemName: c.itemName,
      fields: c.fields.map((f) => ({ ...f, sheetValue: humanize(f.sheetValue, f.field, preview.masterMaps), firebaseValue: humanize(f.firebaseValue, f.field, preview.masterMaps) }))
    })),
    missingFromSheet: preview.missingFromSheet,
    newColumns: preview.newColumns,
    missingColumns: preview.missingColumns,
    warnings: preview.warnings,
    newProductCount: preview.newProducts.length,
    newSheetRowCount: preview.newSheetRows.length
  };
});

exports.syncNow = onCall({ secrets: [SYNC_SHARED_SECRET] }, async (request) => {
  const { uid } = requireSyncPermission(request);
  const db = admin.firestore();
  const preview = await computePreview(db);
  const maps = preview.masterMaps;

  const result = { productsAdded: 0, productsUpdated: 0, stockAdjustments: 0, rowsPushedToSheet: 0, conflicts: preview.conflicts.length, warnings: preview.warnings, errors: [] };
  const sheetWriteQueue = [];
  const now = admin.firestore.FieldValue.serverTimestamp();

  for (const { productId: givenId, row, useGivenId } of preview.newProducts) {
    try {
      const productId = useGivenId ? givenId : await allocateProductId(db);
      const fields = row.resolvedFields;
      const contentHash = row.contentHash;
      const openingStock = Number(fields.currentStock) || 0;

      await db.collection('products').doc(productId).set({
        ...Object.fromEntries(SYNCED_FIELDS.filter((k) => k !== 'currentStock').map((k) => [k, fields[k] ?? ''])),
        productId, currentStock: 0, storeId: 'store-001',
        createdAt: now, updatedAt: now, createdBy: 'sync', updatedBy: 'sync',
        sync: {
          sheetRowId: row.rowIndex, lastSheetModifiedAt: now, lastFirebaseModifiedAt: now,
          lastSyncedAt: now, lastModifiedSource: 'SYSTEM', syncVersion: 1,
          contentHash, lastSyncedHash: contentHash, syncStatus: 'synced', syncError: null
        }
      });

      if (openingStock > 0) {
        await applyStockChange(db, { productId, type: 'OPENING', quantityChange: openingStock, source: 'GOOGLE_SHEET', userId: uid, remarks: 'Opening stock from Google Sheet sync.' });
      }

      sheetWriteQueue.push({ productId, rowIndex: row.rowIndex, isNewRow: false, valuesByHeader: { 'Product ID': productId, 'Firebase ID': productId, 'Sync Version': 1, 'Last Sync': new Date().toISOString() } });
      result.productsAdded++;
      await logAuditServer(db, { userId: uid, action: 'PRODUCT_CREATED', module: 'sync', recordId: productId, source: 'GOOGLE_SHEET' });
    } catch (err) {
      result.errors.push({ productId: givenId || row.resolvedFields.itemName, error: err.message });
    }
  }

  const changesByProduct = groupBy(preview.changes, (c) => c.productId);
  for (const [productId, fieldChanges] of changesByProduct) {
    try {
      const fromSheet = fieldChanges.some((c) => c.source === 'GOOGLE_SHEET');
      const productRef = db.collection('products').doc(productId);
      const rowIndex = fieldChanges[0].rowIndex;

      const plainUpdates = {};
      const valuesByHeader = {};
      for (const c of fieldChanges) {
        if (c.action === 'STOCK_ADJUSTMENT') {
          const delta = Number(c.newValue) - Number(c.oldValue);
          await applyStockChange(db, { productId, type: fromSheet ? 'STOCK_CORRECTION' : 'MANUAL_ADJUSTMENT', quantityChange: delta, source: fromSheet ? 'GOOGLE_SHEET' : 'POS', userId: uid, remarks: `Sync-detected stock change via ${c.source}.` });
          result.stockAdjustments++;
        } else if (fromSheet) {
          plainUpdates[c.field] = c.newValue;
        } else {
          valuesByHeader[c.header] = cellValue(c.field, c.newValue, maps);
        }
      }

      let freshHash = null;
      if (Object.keys(plainUpdates).length || fieldChanges.some((c) => c.action === 'STOCK_ADJUSTMENT')) {
        const currentData = (await productRef.get()).data();
        freshHash = hashSyncedFields(buildSyncSubset({ ...currentData, ...plainUpdates }));
        await productRef.update({
          ...plainUpdates, updatedAt: now, updatedBy: 'sync',
          'sync.lastFirebaseModifiedAt': now, 'sync.lastModifiedSource': 'SYSTEM',
          'sync.lastSyncedAt': now, 'sync.lastSyncedHash': freshHash, 'sync.contentHash': freshHash,
          'sync.syncStatus': 'synced', 'sync.sheetRowId': rowIndex,
          'sync.syncVersion': admin.firestore.FieldValue.increment(1)
        });
      }
      if (Object.keys(valuesByHeader).length) {
        sheetWriteQueue.push({ productId, rowIndex, isNewRow: false, valuesByHeader: { ...valuesByHeader, 'Last Sync': new Date().toISOString() } });
        if (freshHash === null) {
          const currentData = (await productRef.get()).data();
          freshHash = hashSyncedFields(buildSyncSubset(currentData));
        }
        await productRef.update({
          'sync.lastFirebaseModifiedAt': now, 'sync.lastModifiedSource': 'SYSTEM',
          'sync.lastSyncedAt': now, 'sync.lastSyncedHash': freshHash, 'sync.contentHash': freshHash, 'sync.syncStatus': 'synced'
        });
      }
      result.productsUpdated++;
      await logAuditServer(db, { userId: uid, action: 'PRODUCT_SYNCED', module: 'sync', recordId: productId, source: fromSheet ? 'GOOGLE_SHEET' : 'POS' });
    } catch (err) {
      result.errors.push({ productId, error: err.message });
    }
  }

  for (const { productId, fsProduct } of preview.newSheetRows) {
    try {
      const valuesByHeader = { 'Product ID': productId, 'Firebase ID': productId, 'Created Date': toIsoOrBlank(fsProduct.createdAt), 'Updated Date': new Date().toISOString(), 'Sync Version': 1, 'Last Sync': new Date().toISOString() };
      for (const key of SYNCED_FIELDS) valuesByHeader[FIELD_TO_HEADER[key]] = cellValue(key, fsProduct[key], maps);
      sheetWriteQueue.push({ productId, isNewRow: true, valuesByHeader });

      const contentHash = hashSyncedFields(buildSyncSubset(fsProduct));
      await db.collection('products').doc(productId).update({
        'sync.lastFirebaseModifiedAt': now, 'sync.lastModifiedSource': 'SYSTEM', 'sync.lastSyncedAt': now,
        'sync.lastSyncedHash': contentHash, 'sync.contentHash': contentHash, 'sync.syncStatus': 'synced'
      });
      result.rowsPushedToSheet++;
    } catch (err) {
      result.errors.push({ productId, error: err.message });
    }
  }

  for (const conflict of preview.conflicts) {
    await db.collection('syncConflicts').doc(conflict.productId).set({
      itemName: conflict.itemName, fields: conflict.fields, rowIndex: conflict.rowIndex,
      detectedAt: now, status: 'open'
    });
    await db.collection('products').doc(conflict.productId).update({ 'sync.syncStatus': 'conflict' });
  }

  for (const missing of preview.missingFromSheet) {
    await db.collection('syncFlags').doc(missing.productId).set({
      type: 'MISSING_FROM_SHEET', itemName: missing.itemName, detectedAt: now, status: 'open'
    }, { merge: true });
  }

  if (sheetWriteQueue.length) {
    try {
      await applySheetWrites(sheetWriteQueue);
    } catch (err) {
      result.errors.push({ productId: 'SHEET_WRITE_BATCH', error: err.message });
    }
  }

  const syncLogEntry = { dateTime: now, direction: 'TWO_WAY', ...result, userId: uid };
  const logRef = await db.collection('syncLogs').add(syncLogEntry);
  try { await writeSheetSyncLog({ syncId: logRef.id, ...result, dateTime: new Date().toISOString() }); } catch (e) { /* Sheet-side log tab is a convenience mirror, non-fatal */ }

  return { syncId: logRef.id, ...result };
});

exports.resolveConflict = onCall({ secrets: [SYNC_SHARED_SECRET] }, async (request) => {
  const { uid } = requireSyncPermission(request);
  const { productId, resolution } = request.data || {};
  if (!productId || !['USE_SHEET', 'USE_FIREBASE'].includes(resolution)) {
    throw new HttpsError('invalid-argument', 'productId and resolution (USE_SHEET|USE_FIREBASE) are required.');
  }
  const db = admin.firestore();
  const maps = await loadMasterMaps(db);
  const conflictRef = db.collection('syncConflicts').doc(productId);
  const conflictSnap = await conflictRef.get();
  if (!conflictSnap.exists) throw new HttpsError('not-found', 'No open conflict for this product.');
  const conflict = conflictSnap.data();

  const productRef = db.collection('products').doc(productId);
  const now = admin.firestore.FieldValue.serverTimestamp();

  if (resolution === 'USE_SHEET') {
    const updates = {};
    const stockField = conflict.fields.find((f) => f.field === 'currentStock');
    for (const f of conflict.fields) {
      if (f.field === 'currentStock') continue;
      updates[f.field] = f.sheetValue; // already a raw ID/value, stored that way in the conflict doc
    }
    if (Object.keys(updates).length) await productRef.update({ ...updates, updatedAt: now, updatedBy: 'sync' });
    if (stockField) {
      const fsProduct = (await productRef.get()).data();
      await applyStockChange(db, { productId, type: 'STOCK_CORRECTION', quantityChange: Number(stockField.sheetValue) - Number(fsProduct.currentStock), source: 'GOOGLE_SHEET', userId: uid, remarks: 'Conflict resolved: used Google Sheet value.' });
    }
  } else {
    const fsProduct = (await productRef.get()).data();
    const valuesByHeader = {};
    for (const f of conflict.fields) valuesByHeader[FIELD_TO_HEADER[f.field]] = cellValue(f.field, fsProduct[f.field], maps);
    valuesByHeader['Last Sync'] = new Date().toISOString();
    await applySheetWrites([{ productId, rowIndex: conflict.rowIndex, isNewRow: false, valuesByHeader }]);
  }

  const fresh = (await productRef.get()).data();
  const contentHash = hashSyncedFields(buildSyncSubset(fresh));
  await productRef.update({
    'sync.lastModifiedSource': 'SYSTEM', 'sync.lastSyncedAt': now,
    'sync.lastSyncedHash': contentHash, 'sync.contentHash': contentHash, 'sync.syncStatus': 'synced'
  });
  await conflictRef.update({ status: 'resolved', resolution, resolvedBy: uid, resolvedAt: now });
  await logAuditServer(db, { userId: uid, action: 'CONFLICT_RESOLVED', module: 'sync', recordId: productId, newValue: resolution, source: 'POS' });

  return { ok: true };
});

exports.resolveMissingFromSheet = onCall({ secrets: [SYNC_SHARED_SECRET] }, async (request) => {
  const { uid } = requireSyncPermission(request);
  const { productId, action } = request.data || {};
  if (!productId || !['ARCHIVE', 'RESTORE', 'IGNORE'].includes(action)) {
    throw new HttpsError('invalid-argument', 'productId and action (ARCHIVE|RESTORE|IGNORE) are required.');
  }
  const db = admin.firestore();
  const flagRef = db.collection('syncFlags').doc(productId);
  const productRef = db.collection('products').doc(productId);
  const now = admin.firestore.FieldValue.serverTimestamp();

  if (action === 'ARCHIVE') {
    await productRef.update({ status: 'archived', updatedAt: now, updatedBy: uid, 'sync.lastModifiedSource': 'POS', 'sync.syncStatus': 'pending' });
    await flagRef.delete();
    await logAuditServer(db, { userId: uid, action: 'PRODUCT_ARCHIVED', module: 'sync', recordId: productId, source: 'POS' });
  } else if (action === 'RESTORE') {
    const maps = await loadMasterMaps(db);
    const fsProduct = (await productRef.get()).data();
    const valuesByHeader = { 'Product ID': productId, 'Firebase ID': productId, 'Last Sync': new Date().toISOString() };
    for (const key of SYNCED_FIELDS) valuesByHeader[FIELD_TO_HEADER[key]] = cellValue(key, fsProduct[key], maps);
    await applySheetWrites([{ productId, isNewRow: true, valuesByHeader }]);
    const contentHash = hashSyncedFields(buildSyncSubset(fsProduct));
    await productRef.update({ 'sync.lastSyncedHash': contentHash, 'sync.contentHash': contentHash, 'sync.syncStatus': 'synced', 'sync.lastSyncedAt': now });
    await flagRef.delete();
  } else {
    await flagRef.set({ status: 'ignored', ignoredBy: uid, ignoredAt: now }, { merge: true });
  }

  return { ok: true };
});

function groupBy(arr, keyFn) {
  const map = new Map();
  for (const item of arr) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

function toIsoOrBlank(ts) {
  try { return ts?.toDate ? ts.toDate().toISOString() : ''; } catch { return ''; }
}

async function logAuditServer(db, { userId, action, module, recordId, field = null, oldValue = null, newValue = null, source }) {
  await db.collection('auditLogs').add({
    dateTime: admin.firestore.FieldValue.serverTimestamp(),
    userId, action, module, recordId, field, oldValue, newValue, source
  });
}
