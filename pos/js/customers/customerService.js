import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, query, orderBy, where, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db, STORE_ID } from '../firebase/init.js';
import { allocateCustomerId } from '../utils/idGenerator.js';
import { isValidEmail, isValidMobile } from '../utils/validation.js';
import { logAudit } from '../utils/auditLog.js';

const COLLECTION = 'customers';

export function emptyCustomerDraft() {
  return { name: '', mobile: '', email: '', address: '', gstin: '', creditLimit: '', openingBalance: '', status: 'active', notes: '' };
}

export async function createCustomer(draft, { userId }) {
  if (!draft.name?.trim()) throw new Error('Customer name is required.');
  if (!isValidEmail(draft.email)) throw new Error('Email is not valid.');
  if (!isValidMobile(draft.mobile)) throw new Error('Mobile number is not valid.');

  const customerId = await allocateCustomerId();
  const payload = {
    ...draft, customerId, storeId: STORE_ID,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: userId, updatedBy: userId
  };
  await setDoc(doc(db, COLLECTION, customerId), payload);
  await logAudit({ userId, action: 'CUSTOMER_CREATED', module: 'customers', recordId: customerId, newValue: payload, source: 'POS' });
  return customerId;
}

export async function updateCustomer(customerId, changes, { userId }) {
  if (changes.email && !isValidEmail(changes.email)) throw new Error('Email is not valid.');
  if (changes.mobile && !isValidMobile(changes.mobile)) throw new Error('Mobile number is not valid.');
  await updateDoc(doc(db, COLLECTION, customerId), { ...changes, updatedAt: serverTimestamp(), updatedBy: userId });
  await logAudit({ userId, action: 'CUSTOMER_UPDATED', module: 'customers', recordId: customerId, newValue: changes, source: 'POS' });
}

export async function getCustomer(customerId) {
  const snap = await getDoc(doc(db, COLLECTION, customerId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function listCustomers({ status = 'active' } = {}) {
  const snap = await getDocs(query(collection(db, COLLECTION), where('status', '==', status), orderBy('name')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
