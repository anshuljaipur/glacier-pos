import {
  collection, doc, setDoc, updateDoc, getDocs, query, orderBy, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db, STORE_ID } from '../firebase/init.js';
import { logAudit } from '../utils/auditLog.js';

/** Must match functions/src/lib/masterResolver.js's slugify() exactly, so a
 * name typed in the POS and the same name typed in the Sheet resolve to the
 * same master record instead of creating a duplicate. */
export function slugify(name) {
  return String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * @param {string} collectionName one of 'categories' | 'subCategories' | 'brands' | 'units'
 * @param {boolean} hasParent whether documents carry a parentId (used for subCategories -> categoryId)
 */
export function createSimpleMasterService(collectionName, { hasParent = false } = {}) {
  function subscribe(callback) {
    const q = query(collection(db, collectionName), orderBy('name'));
    return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }

  async function list() {
    const snap = await getDocs(query(collection(db, collectionName), orderBy('name')));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async function add(name, { userId, parentId = null } = {}) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Name is required.');
    const id = slugify(trimmed);
    const payload = {
      name: trimmed, active: true, storeId: STORE_ID,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: userId
    };
    if (hasParent) payload.parentId = parentId || null;
    await setDoc(doc(db, collectionName, id), payload, { merge: true });
    await logAudit({ userId, action: `${collectionName.toUpperCase()}_CREATED`, module: 'masters', recordId: id, newValue: payload, source: 'POS' });
    return id;
  }

  async function setActive(id, active, userId) {
    await updateDoc(doc(db, collectionName, id), { active, updatedAt: serverTimestamp() });
    await logAudit({ userId, action: active ? `${collectionName.toUpperCase()}_REACTIVATED` : `${collectionName.toUpperCase()}_DEACTIVATED`, module: 'masters', recordId: id, source: 'POS' });
  }

  return { subscribe, list, add, setActive, slugify };
}

export const categoryService = createSimpleMasterService('categories');
export const subCategoryService = createSimpleMasterService('subCategories', { hasParent: true });
export const brandService = createSimpleMasterService('brands');
export const unitService = createSimpleMasterService('units');
