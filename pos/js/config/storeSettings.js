import { doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase/init.js';

const DOC = doc(db, 'settings', 'storeInfo');

export async function getStoreInfo() {
  const snap = await getDoc(DOC);
  return snap.exists() ? snap.data() : { name: '', address: '', gstin: '' };
}

export async function setStoreInfo({ name, address, gstin }, userId) {
  await setDoc(DOC, { name, address, gstin, updatedAt: serverTimestamp(), updatedBy: userId }, { merge: true });
}
