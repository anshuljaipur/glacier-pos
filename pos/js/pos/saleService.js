import {
  doc, collection, writeBatch, getDoc, getDocs, setDoc, updateDoc, query, where,
  orderBy, limit, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db, STORE_ID, connectivity } from '../firebase/init.js';
import { allocateInvoiceNumber } from '../utils/idGenerator.js';
import { queueSaleLineStockChange } from '../inventory/stockLedger.js';
import { computeLine, computeBill, sumPayments } from './billingCalc.js';
import { logAudit } from '../utils/auditLog.js';

const COLLECTION = 'sales';

/**
 * @param {Array} cartItems  [{ productId, barcode, itemName, hsn, qty, rate, mrp, discountAmount, gstPercent }]
 * @param {{customerId:?string, billDiscount:number, paymentDetails:Array<{method:string, amount:number}>, userId:string}} opts
 */
export async function createSale(cartItems, { customerId = null, billDiscount = 0, paymentDetails, userId }) {
  if (!cartItems.length) throw new Error('Cart is empty.');

  const computedItems = cartItems.map((item) => ({ ...item, ...computeLine(item) }));
  const bill = computeBill(computedItems, billDiscount);
  const paid = sumPayments(paymentDetails);
  if (paid < bill.grandTotal - 0.01) {
    throw new Error(`Payment total (₹${paid.toFixed(2)}) is less than the bill total (₹${bill.grandTotal.toFixed(2)}).`);
  }

  // Client-generated ID: unique regardless of connectivity, and re-running
  // this exact call (e.g. a retry after a dropped connection) with the same
  // ID is a no-op overwrite rather than a duplicate sale — the offline
  // duplicate-sale guard from section 30.
  const saleId = crypto.randomUUID();
  const clientSeq = Date.now(); // preserves creation order for invoice-number backfill, since serverTimestamp() doesn't resolve locally offline

  const saleDoc = {
    saleId, storeId: STORE_ID, clientSeq,
    dateTime: serverTimestamp(),
    customerId: customerId || null,
    userId,
    items: computedItems.map((item) => ({
      productId: item.productId,
      barcode: item.barcode || '',
      itemNameSnapshot: item.itemName, // section 57: never re-derived from the current master later
      hsn: item.hsn || '',
      qty: Number(item.qty),
      rate: Number(item.rate),
      mrp: Number(item.mrp) || 0,
      discountAmount: Number(item.discountAmount) || 0,
      gstPercent: Number(item.gstPercent) || 0,
      taxableValue: item.taxableValue,
      gstAmount: item.gstAmount,
      lineTotal: item.lineTotal
    })),
    subtotal: bill.subtotal,
    billDiscount: bill.billDiscount,
    tax: bill.tax,
    grandTotal: bill.grandTotal,
    paymentDetails: paymentDetails,
    status: 'completed',
    invoiceNumber: null,
    invoiceNumberPending: true
  };

  const batch = writeBatch(db);
  batch.set(doc(db, COLLECTION, saleId), saleDoc);
  for (const item of computedItems) {
    await queueSaleLineStockChange(batch, { productId: item.productId, quantitySold: item.qty, saleId, userId });
  }
  await batch.commit();

  await logAudit({ userId, action: 'SALE_COMPLETED', module: 'sales', recordId: saleId, newValue: { grandTotal: bill.grandTotal }, source: 'POS' });

  // Best-effort immediate invoice numbering — only succeeds if we're
  // actually online, since it needs the transaction-based counter
  // allocator. If it fails (offline, or the transaction times out), the
  // sale is still fully recorded; reconcilePendingInvoiceNumbers() below
  // will pick it up once connectivity returns.
  if (connectivity.online) {
    try {
      await assignInvoiceNumber(saleId);
    } catch {
      // leave invoiceNumberPending: true — reconciliation will retry
    }
  }

  return { saleId, ...saleDoc };
}

async function assignInvoiceNumber(saleId) {
  const invoiceNumber = await allocateInvoiceNumber();
  await updateDoc(doc(db, COLLECTION, saleId), { invoiceNumber, invoiceNumberPending: false });
  return invoiceNumber;
}

/**
 * Call once at POS startup and again whenever connectivity comes back
 * online: finds every sale still missing an invoice number and assigns
 * them strictly in the order they were originally made (clientSeq), so a
 * batch of offline sales gets sequential numbers in the right order
 * instead of whatever order their writes happen to sync in.
 */
export async function reconcilePendingInvoiceNumbers() {
  const q = query(collection(db, COLLECTION), where('invoiceNumberPending', '==', true), orderBy('clientSeq', 'asc'), limit(50));
  const snap = await getDocs(q);
  const results = [];
  for (const docSnap of snap.docs) {
    try {
      const invoiceNumber = await assignInvoiceNumber(docSnap.id);
      results.push({ saleId: docSnap.id, invoiceNumber });
    } catch (err) {
      results.push({ saleId: docSnap.id, error: err.message });
    }
  }
  return results;
}

/** Wires reconciliation to the connectivity banner — call once per page that creates sales. */
export function watchConnectivityForInvoiceReconciliation() {
  return connectivity.subscribe((online) => {
    if (online) reconcilePendingInvoiceNumbers().catch(() => {});
  });
}

export async function getSale(saleId) {
  const snap = await getDoc(doc(db, COLLECTION, saleId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function listRecentSales({ max = 50 } = {}) {
  const q = query(collection(db, COLLECTION), orderBy('clientSeq', 'desc'), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Looks up a sale by its human-readable invoice number — the reference a
 * return is required to be made against (section 22). */
export async function findSaleByInvoiceNumber(invoiceNumber) {
  const q = query(collection(db, COLLECTION), where('invoiceNumber', '==', invoiceNumber.trim()), limit(1));
  const snap = await getDocs(q);
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}
