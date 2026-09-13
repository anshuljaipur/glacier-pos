import { doc, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase/init.js';

/**
 * Allocates the next sequential, permanent ID for a given entity type using
 * a Firestore transaction against counters/{name} so two simultaneous
 * "Add Product" clicks (POS + Sheet sync running at once) can never collide
 * — section 40/47 concurrency requirements.
 *
 * @param {string} name   e.g. 'products', 'customers', 'suppliers'
 * @param {string} prefix e.g. 'PROD', 'CUST', 'SUPP'
 * @param {number} padLength
 */
export async function allocateId(name, prefix, padLength = 6) {
  const counterRef = doc(db, 'counters', name);
  const next = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists() ? (snap.data().next || 0) : 0;
    const value = current + 1;
    tx.set(counterRef, { next: value }, { merge: true });
    return value;
  });
  return `${prefix}-${String(next).padStart(padLength, '0')}`;
}

export const allocateProductId = () => allocateId('products', 'PROD');
export const allocateCustomerId = () => allocateId('customers', 'CUST');
export const allocateSupplierId = () => allocateId('suppliers', 'SUPP');
export const allocateInvoiceNumber = () => allocateId('invoices', 'INV');
export const allocatePurchaseId = () => allocateId('purchases', 'PUR');
export const allocatePurchaseReturnId = () => allocateId('purchaseReturns', 'PRET');
export const allocateSalesReturnId = () => allocateId('salesReturns', 'SRET');
