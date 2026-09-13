import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, query, orderBy, where, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db, STORE_ID } from '../firebase/init.js';
import { allocateSupplierId } from '../utils/idGenerator.js';
import { isValidEmail, isValidMobile } from '../utils/validation.js';
import { logAudit } from '../utils/auditLog.js';

const COLLECTION = 'suppliers';

export function emptySupplierDraft() {
  return { name: '', mobile: '', email: '', address: '', gstin: '', openingBalance: '', paymentTerms: '', status: 'active', notes: '' };
}

export async function createSupplier(draft, { userId }) {
  if (!draft.name?.trim()) throw new Error('Supplier name is required.');
  if (!isValidEmail(draft.email)) throw new Error('Email is not valid.');
  if (!isValidMobile(draft.mobile)) throw new Error('Mobile number is not valid.');

  const supplierId = await allocateSupplierId();
  const payload = {
    ...draft, supplierId, storeId: STORE_ID,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: userId, updatedBy: userId
  };
  await setDoc(doc(db, COLLECTION, supplierId), payload);
  await logAudit({ userId, action: 'SUPPLIER_CREATED', module: 'suppliers', recordId: supplierId, newValue: payload, source: 'POS' });
  return supplierId;
}

export async function updateSupplier(supplierId, changes, { userId }) {
  if (changes.email && !isValidEmail(changes.email)) throw new Error('Email is not valid.');
  if (changes.mobile && !isValidMobile(changes.mobile)) throw new Error('Mobile number is not valid.');
  await updateDoc(doc(db, COLLECTION, supplierId), { ...changes, updatedAt: serverTimestamp(), updatedBy: userId });
  await logAudit({ userId, action: 'SUPPLIER_UPDATED', module: 'suppliers', recordId: supplierId, newValue: changes, source: 'POS' });
}

export async function getSupplier(supplierId) {
  const snap = await getDoc(doc(db, COLLECTION, supplierId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function listSuppliers({ status = 'active' } = {}) {
  const snap = await getDocs(query(collection(db, COLLECTION), where('status', '==', status), orderBy('name')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
