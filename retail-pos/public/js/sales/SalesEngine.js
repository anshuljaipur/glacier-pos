/**
 * js/sales/SalesEngine.js
 * Handles atomic checkouts and ledger updates
 */

export class SalesEngine {
  constructor(firestoreDb, authUser) {
    this.db = firestoreDb;
    this.user = authUser;
  }

  /**
   * Completes sale atomically: decrement inventory, write stock ledger, generate invoice
   */
  async processSale(salePayload) {
    const { items, customerId, paymentDetails, storeId = 'STORE-001' } = salePayload;
    
    return await this.db.runTransaction(async (transaction) => {
      const productDocs = [];
      
      // 1. Read phase: Read all product records to verify stock levels
      for (const item of items) {
        const prodRef = this.db.collection('products').doc(item.productId);
        const doc = await transaction.get(prodRef);
        if (!doc.exists) {
          throw new Error(`Product not found: ${item.productId}`);
        }
        const currentData = doc.data();
        if (currentData.status !== 'active') {
          throw new Error(`Product ${currentData.itemName} is currently inactive and cannot be sold.`);
        }
        if (currentData.currentStock < item.qty) {
          throw new Error(`Insufficient stock for ${currentData.itemName}. Available: ${currentData.currentStock}, Requested: ${item.qty}`);
        }
        productDocs.push({ ref: prodRef, data: currentData, item });
      }

      // Generate stable invoice number
      const invoiceNum = `INV-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const nowTimestamp = new Date().toISOString();

      let subtotal = 0;
      let totalTax = 0;
      let grandTotal = 0;

      const finalizedItems = [];

      // 2. Mutation phase: Update stocks, write ledger entries, and prepare invoice
      for (const entry of productDocs) {
        const { ref, data, item } = entry;
        const newStock = data.currentStock - item.qty;

        // Decrement product stock
        transaction.update(ref, {
          currentStock: newStock,
          updatedAt: nowTimestamp,
          updatedBy: this.user.uid,
          'syncMetadata.lastFirebaseModifiedAt': nowTimestamp,
          'syncMetadata.lastModifiedSource': 'POS'
        });

        // Write append-only stock ledger entry
        const ledgerRef = this.db.collection('stockLedger').doc();
        transaction.set(ledgerRef, {
          ledgerId: ledgerRef.id,
          storeId,
          timestamp: nowTimestamp,
          productId: item.productId,
          transactionType: 'SALE',
          referenceId: invoiceNum,
          quantityChange: -item.qty,
          previousStock: data.currentStock,
          newStock,
          source: 'POS',
          userId: this.user.uid,
          remarks: `Invoice sale ${invoiceNum}`
        });

        // Calculate line tax and totals
        const itemTaxable = (item.rate * item.qty) / (1 + (data.gstRate / 100));
        const itemGst = (item.rate * item.qty) - itemTaxable;

        subtotal += itemTaxable;
        totalTax += itemGst;
        grandTotal += (item.rate * item.qty);

        finalizedItems.push({
          productId: item.productId,
          barcode: data.barcode,
          itemNameSnapshot: data.itemName,
          hsnSnapshot: data.hsnCode,
          qty: item.qty,
          mrpSnapshot: data.mrp,
          rate: item.rate,
          discount: item.discount || 0,
          taxableAmount: parseFloat(itemTaxable.toFixed(2)),
          gstRate: data.gstRate,
          gstAmount: parseFloat(itemGst.toFixed(2)),
          lineTotal: parseFloat((item.rate * item.qty).toFixed(2))
        });
      }

      // Record immutable sales invoice
      const saleRef = this.db.collection('sales').doc();
      const invoiceData = {
        saleId: saleRef.id,
        invoiceNumber: invoiceNum,
        storeId,
        dateTime: nowTimestamp,
        customerId: customerId || 'WALK-IN',
        userId: this.user.uid,
        items: finalizedItems,
        subtotal: parseFloat(subtotal.toFixed(2)),
        totalDiscount: 0,
        totalTax: parseFloat(totalTax.toFixed(2)),
        grandTotal: parseFloat(grandTotal.toFixed(2)),
        paymentDetails,
        status: 'COMPLETED'
      };

      transaction.set(saleRef, invoiceData);
      return invoiceData;
    });
  }
}
