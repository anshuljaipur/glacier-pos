const admin = require('firebase-admin');

const LEDGER_TYPES = [
  'OPENING', 'SALE', 'PURCHASE', 'SALES_RETURN', 'PURCHASE_RETURN',
  'DAMAGE', 'EXPIRED', 'LOST', 'MANUAL_ADJUSTMENT', 'STOCK_CORRECTION',
  'STOCK_TRANSFER', 'FREE_SAMPLE', 'OTHER'
];

/** Mirrors js/inventory/stockLedger.js's applyStockChange for server-side callers. */
async function applyStockChange(db, { productId, type, quantityChange, referenceId = null, source, userId, remarks = '' }) {
  if (!LEDGER_TYPES.includes(type)) throw new Error(`Unknown ledger type: ${type}`);
  const productRef = db.collection('products').doc(productId);
  const ledgerRef = db.collection('stockLedger').doc();

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(productRef);
    if (!snap.exists) throw new Error(`Product ${productId} not found.`);
    const previousStock = Number(snap.data().currentStock || 0);
    const newStock = previousStock + Number(quantityChange);

    tx.set(ledgerRef, {
      dateTime: admin.firestore.FieldValue.serverTimestamp(),
      productId, type, referenceId,
      quantityChange: Number(quantityChange),
      previousStock, newStock, source, userId, remarks
    });
    tx.update(productRef, {
      currentStock: newStock,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: userId
    });
    return { previousStock, newStock, ledgerId: ledgerRef.id };
  });
}

module.exports = { applyStockChange, LEDGER_TYPES };
