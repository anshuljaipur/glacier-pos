import {
  doc, collection, runTransaction, serverTimestamp, increment, getDoc,
  query, where, orderBy, limit, getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db, STORE_ID } from '../firebase/init.js';

export const LEDGER_TYPES = [
  'OPENING', 'SALE', 'PURCHASE', 'SALES_RETURN', 'PURCHASE_RETURN',
  'DAMAGE', 'EXPIRED', 'LOST', 'MANUAL_ADJUSTMENT', 'STOCK_CORRECTION',
  'STOCK_TRANSFER', 'FREE_SAMPLE', 'OTHER'
];

/**
 * Applies a stock change atomically: reads the product's current stock,
 * writes a ledger entry, and updates product.currentStock in the SAME
 * Firestore transaction — so two simultaneous sales (or a sale racing a
 * sync-driven adjustment) can never both read the same "before" stock and
 * silently clobber each other (sections 16/47).
 *
 * @returns {Promise<{previousStock:number newStock:number ledgerId:string}>}
 */
export async function applyStockChange({ productId, type, quantityChange, referenceId = null, source = 'POS', userId, remarks = '' }) {
  if (!LEDGER_TYPES.includes(type)) throw new Error(`Unknown ledger type: ${type}`);

  const productRef = doc(db, 'products', productId);
  const ledgerRef = doc(collection(db, 'stockLedger'));

  return runTransaction(db, async (tx) => {
    const productSnap = await tx.get(productRef);
    if (!productSnap.exists()) throw new Error(`Product ${productId} not found.`);

    const previousStock = Number(productSnap.data().currentStock || 0);
    const newStock = previousStock + Number(quantityChange);

    tx.set(ledgerRef, {
      storeId: STORE_ID,
      dateTime: serverTimestamp(),
      productId,
      type,
      referenceId,
      quantityChange: Number(quantityChange),
      previousStock,
      newStock,
      source,       // 'POS' | 'GOOGLE_SHEET' | 'SYSTEM'
      userId,
      remarks
    });

    tx.update(productRef, {
      currentStock: newStock,
      updatedAt: serverTimestamp(),
      updatedBy: userId
    });

    return { previousStock, newStock, ledgerId: ledgerRef.id };
  });
}

/** Convenience wrapper for a manual/Sheet-sourced correction (section 15). */
export function applyStockAdjustment({ productId, previousStock, newStock, source, userId, remarks }) {
  return applyStockChange({
    productId,
    type: source === 'GOOGLE_SHEET' ? 'STOCK_CORRECTION' : 'MANUAL_ADJUSTMENT',
    quantityChange: newStock - previousStock,
    source,
    userId,
    remarks: remarks || `Adjusted from ${previousStock} to ${newStock} via ${source}.`
  });
}

export async function getLedgerForProduct(productId, { max = 50 } = {}) {
  const q = query(
    collection(db, 'stockLedger'),
    where('productId', '==', productId),
    orderBy('dateTime', 'desc'),
    limit(max)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Queues a SALE stock decrement onto an existing WriteBatch instead of a
 * runTransaction — this is deliberate: Firestore client transactions
 * require a live connection and will stall while offline, which would
 * violate section 30 ("do not lose completed transactions because of
 * temporary connectivity problems"). A batched `increment()` write, by
 * contrast, queues locally and applies atomically on the server once
 * synced, and concurrent increments from other devices/tabs merge
 * correctly without anyone needing to see anyone else's write first.
 *
 * Trade-off, documented rather than hidden: since a batch can't do a read,
 * the ledger's previousStock/newStock here are the best locally-cached
 * estimate at the moment of sale, not a guaranteed-fresh server read. This
 * only matters for the ledger's own display of "before/after" on that one
 * row — currentStock on the product itself is always exactly correct,
 * because it only ever moves via increment(), never a raw overwrite.
 */
export async function queueSaleLineStockChange(batch, { productId, quantitySold, saleId, userId }) {
  const productRef = doc(db, 'products', productId);
  const ledgerRef = doc(collection(db, 'stockLedger'));

  let estimatedPrevious = null;
  try {
    const snap = await getDoc(productRef); // reads from local cache when offline
    estimatedPrevious = Number(snap.data()?.currentStock ?? 0);
  } catch {
    estimatedPrevious = null; // truly no cached copy available yet — leave null rather than guess
  }

  batch.update(productRef, {
    currentStock: increment(-Number(quantitySold)),
    updatedAt: serverTimestamp(),
    updatedBy: userId
  });
  batch.set(ledgerRef, {
    storeId: STORE_ID,
    dateTime: serverTimestamp(),
    productId,
    type: 'SALE',
    referenceId: saleId,
    quantityChange: -Number(quantitySold),
    previousStock: estimatedPrevious,
    newStock: estimatedPrevious === null ? null : estimatedPrevious - Number(quantitySold),
    source: 'POS',
    userId,
    remarks: 'Sale.'
  });
}
