import {
  collection, doc, getDoc, getDocs, setDoc, query, where, orderBy, limit, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db, STORE_ID } from '../firebase/init.js';
import { allocatePurchaseReturnId } from '../utils/idGenerator.js';
import { applyStockChange } from '../inventory/stockLedger.js';
import { logAudit } from '../utils/auditLog.js';
import { round2 } from '../pos/billingCalc.js';

const COLLECTION = 'purchaseReturns';

export async function listPurchaseReturnsForPurchase(purchaseId) {
  const snap = await getDocs(query(collection(db, COLLECTION), where('purchaseId', '==', purchaseId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** How much of each purchased line is still eligible to be returned. */
export async function getReturnableQuantities(purchase) {
  const priorReturns = await listPurchaseReturnsForPurchase(purchase.purchaseId);
  const returnedByProduct = {};
  for (const ret of priorReturns) {
    for (const item of ret.items) {
      returnedByProduct[item.productId] = (returnedByProduct[item.productId] || 0) + item.qty;
    }
  }
  return purchase.items.map((item) => ({
    ...item,
    alreadyReturned: returnedByProduct[item.productId] || 0,
    returnable: item.qty - (returnedByProduct[item.productId] || 0)
  }));
}

/**
 * @param {Array} returnItems [{ productId, itemNameSnapshot, qty, purchasePrice, gstPercent }] — qty being returned now
 */
export async function createPurchaseReturn(purchase, returnItems, { reason = '', userId }) {
  const nonZero = returnItems.filter((i) => Number(i.qty) > 0);
  if (!nonZero.length) throw new Error('Select at least one item and quantity to return.');

  const returnable = await getReturnableQuantities(purchase);
  for (const item of nonZero) {
    const match = returnable.find((r) => r.productId === item.productId);
    if (!match || Number(item.qty) > match.returnable) {
      throw new Error(`Cannot return ${item.qty} of ${item.itemNameSnapshot} — only ${match?.returnable ?? 0} remaining eligible for return.`);
    }
  }

  const computed = nonZero.map((item) => {
    const taxableValue = round2(Number(item.qty) * Number(item.purchasePrice));
    const gstAmount = round2(taxableValue * (Number(item.gstPercent) || 0) / 100);
    return { ...item, taxableValue, gstAmount, lineTotal: round2(taxableValue + gstAmount) };
  });
  const subtotal = round2(computed.reduce((s, i) => s + i.taxableValue, 0));
  const tax = round2(computed.reduce((s, i) => s + i.gstAmount, 0));
  const grandTotal = round2(subtotal + tax);

  const returnId = await allocatePurchaseReturnId();
  await setDoc(doc(db, COLLECTION, returnId), {
    returnId, storeId: STORE_ID, purchaseId: purchase.purchaseId, supplierId: purchase.supplierId,
    dateTime: serverTimestamp(), userId, reason,
    items: computed.map((i) => ({
      productId: i.productId, itemNameSnapshot: i.itemNameSnapshot, qty: Number(i.qty),
      purchasePrice: Number(i.purchasePrice), gstPercent: Number(i.gstPercent) || 0,
      taxableValue: i.taxableValue, gstAmount: i.gstAmount, lineTotal: i.lineTotal
    })),
    subtotal, tax, grandTotal, status: 'completed'
  });

  for (const item of computed) {
    await applyStockChange({
      productId: item.productId, type: 'PURCHASE_RETURN', quantityChange: -Number(item.qty),
      referenceId: returnId, source: 'POS', userId, remarks: `Return against purchase ${purchase.purchaseId}.`
    });
  }

  await logAudit({ userId, action: 'PURCHASE_RETURN_CREATED', module: 'returns', recordId: returnId, newValue: { grandTotal }, source: 'POS' });
  return returnId;
}

export async function listRecentPurchaseReturns({ max = 50 } = {}) {
  const snap = await getDocs(query(collection(db, COLLECTION), orderBy('dateTime', 'desc'), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
