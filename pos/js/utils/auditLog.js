import { collection, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db, STORE_ID } from '../firebase/init.js';

/**
 * Writes one audit log entry. Called by every service module (products,
 * sales, purchases, sync, ...) after a mutating operation — never optional,
 * per section 29 ("Every important change must be auditable").
 */
export async function logAudit({ userId, action, module, recordId, field = null, oldValue = null, newValue = null, source = 'POS' }) {
  await addDoc(collection(db, 'auditLogs'), {
    storeId: STORE_ID,
    dateTime: serverTimestamp(),
    userId,
    action,      // e.g. 'PRICE_UPDATED', 'PRODUCT_CREATED', 'STOCK_ADJUSTED'
    module,      // e.g. 'products', 'sync', 'sales'
    recordId,
    field,
    oldValue,
    newValue,
    source       // 'POS' | 'GOOGLE_SHEET' | 'SYSTEM'
  });
}
