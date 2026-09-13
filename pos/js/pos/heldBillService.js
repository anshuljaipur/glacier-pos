import {
  collection, doc, setDoc, deleteDoc, getDocs, query, orderBy, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db, STORE_ID } from '../firebase/init.js';

const COLLECTION = 'heldBills';

export async function holdBill({ cartItems, customerId, billDiscount, label, userId }) {
  const id = crypto.randomUUID();
  await setDoc(doc(db, COLLECTION, id), {
    storeId: STORE_ID, cartItems, customerId: customerId || null, billDiscount: billDiscount || 0,
    label: label || `Held ${new Date().toLocaleTimeString()}`,
    heldAt: serverTimestamp(), heldBy: userId
  });
  return id;
}

export async function listHeldBills() {
  const snap = await getDocs(query(collection(db, COLLECTION), orderBy('heldAt', 'desc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function deleteHeldBill(id) {
  await deleteDoc(doc(db, COLLECTION, id));
}
