import {
  collection, doc, getDoc, getDocs, setDoc, query, orderBy, limit, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db, STORE_ID } from '../firebase/init.js';
import { allocatePurchaseId } from '../utils/idGenerator.js';
import { applyStockChange } from '../inventory/stockLedger.js';
import { logAudit } from '../utils/auditLog.js';
import { round2 } from '../pos/billingCalc.js';

const COLLECTION = 'purchases';

function computePurchaseLine(item) {
  const qty = Number(item.qty) || 0;
  const price = Number(item.purchasePrice) || 0;
  const gstPercent = Number(item.gstPercent) || 0;
  const taxableValue = qty * price;
  const gstAmount = taxableValue * (gstPercent / 100);
  return { taxableValue: round2(taxableValue), gstAmount: round2(gstAmount), lineTotal: round2(taxableValue + gstAmount) };
}

/**
 * @param {Array} items [{ productId, itemName, hsn, qty, purchasePrice, gstPercent, batchNumber, expiryDate }]
 */
export async function createPurchase(items, { supplierId, invoiceRef = '', paymentStatus = 'unpaid', amountPaid = 0, userId }) {
  if (!items.length) throw new Error('Add at least one item to the purchase.');
  if (!supplierId) throw new Error('Select a supplier.');

  const computedItems = items.map((item) => ({ ...item, ...computePurchaseLine(item) }));
  const subtotal = round2(computedItems.reduce((s, i) => s + i.taxableValue, 0));
  const tax = round2(computedItems.reduce((s, i) => s + i.gstAmount, 0));
  const grandTotal = round2(subtotal + tax);

  const purchaseId = await allocatePurchaseId();
  const purchaseDoc = {
    purchaseId, storeId: STORE_ID, supplierId, invoiceRef,
    dateTime: serverTimestamp(), clientSeq: Date.now(), userId,
    items: computedItems.map((i) => ({
      productId: i.productId, itemNameSnapshot: i.itemName, hsn: i.hsn || '',
      qty: Number(i.qty), purchasePrice: Number(i.purchasePrice), gstPercent: Number(i.gstPercent) || 0,
      batchNumber: i.batchNumber || '', expiryDate: i.expiryDate || '',
      taxableValue: i.taxableValue, gstAmount: i.gstAmount, lineTotal: i.lineTotal
    })),
    subtotal, tax, grandTotal,
    paymentStatus, amountPaid: Number(amountPaid) || 0,
    status: 'posted'
  };

  await setDoc(doc(db, COLLECTION, purchaseId), purchaseDoc);

  for (const item of computedItems) {
    await applyStockChange({
      productId: item.productId, type: 'PURCHASE', quantityChange: Number(item.qty),
      referenceId: purchaseId, source: 'POS', userId,
      remarks: `Purchase from supplier ${supplierId}${invoiceRef ? ` (ref ${invoiceRef})` : ''}.`
    });
  }

  await logAudit({ userId, action: 'PURCHASE_POSTED', module: 'purchases', recordId: purchaseId, newValue: { grandTotal }, source: 'POS' });
  return purchaseId;
}

export async function getPurchase(purchaseId) {
  const snap = await getDoc(doc(db, COLLECTION, purchaseId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function listRecentPurchases({ max = 50 } = {}) {
  const snap = await getDocs(query(collection(db, COLLECTION), orderBy('clientSeq', 'desc'), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
