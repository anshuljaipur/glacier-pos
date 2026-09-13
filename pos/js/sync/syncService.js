import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';
import { functions } from '../firebase/init.js';
import { collection, query, orderBy, limit, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase/init.js';

export const previewSync = () => httpsCallable(functions, 'previewSync')().then((r) => r.data);
export const syncNow = () => httpsCallable(functions, 'syncNow')().then((r) => r.data);
export const mirrorMastersToSheet = () => httpsCallable(functions, 'mirrorMastersToSheet')().then((r) => r.data);
export const resolveConflict = (productId, resolution) =>
  httpsCallable(functions, 'resolveConflict')({ productId, resolution }).then((r) => r.data);
export const resolveMissingFromSheet = (productId, action) =>
  httpsCallable(functions, 'resolveMissingFromSheet')({ productId, action }).then((r) => r.data);

export async function getRecentSyncLogs(max = 10) {
  const q = query(collection(db, 'syncLogs'), orderBy('dateTime', 'desc'), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
