import {
  collection, doc, getDocs, setDoc, updateDoc, query, orderBy,
  serverTimestamp, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db, STORE_ID } from '../firebase/init.js';
import { logAudit } from '../utils/auditLog.js';

export const FIELD_TYPES = [
  'text', 'number', 'currency', 'date', 'datetime', 'boolean',
  'dropdown', 'multiselect', 'url', 'imageUrl', 'percentage'
];

const COLLECTION = 'customFieldDefs';
let cache = null; // in-memory cache, refreshed by the live subscription below

/**
 * Live subscription so the whole app (Add Product form, POS search filters,
 * inventory grid, reports) reacts immediately when an admin adds/disables a
 * field — no code changes required anywhere else, satisfying section 3.
 */
export function subscribeFieldDefs(callback) {
  const q = query(collection(db, COLLECTION), orderBy('sortOrder', 'asc'));
  return onSnapshot(q, (snap) => {
    cache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(cache);
  });
}

export async function getFieldDefs({ forceRefresh = false } = {}) {
  if (cache && !forceRefresh) return cache;
  const q = query(collection(db, COLLECTION), orderBy('sortOrder', 'asc'));
  const snap = await getDocs(q);
  cache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return cache;
}

/**
 * Adds a new custom field definition. `id` becomes the key used inside
 * every product's customFields map, so it's slugified and immutable once
 * created (renaming fieldName later is fine — the key stays stable so
 * historical product data never breaks).
 */
export async function addFieldDef(def, userId) {
  const id = slugify(def.fieldName);
  const existing = await getFieldDefs({ forceRefresh: true });
  if (existing.some((f) => f.id === id)) {
    throw new Error(`A field with key "${id}" already exists.`);
  }
  const payload = {
    fieldName: def.fieldName,
    fieldType: def.fieldType,
    required: !!def.required,
    defaultValue: def.defaultValue ?? null,
    options: def.options || null, // for dropdown/multiselect
    visibleInPos: def.visibleInPos !== false,
    visibleInInventory: def.visibleInInventory !== false,
    visibleInSearch: !!def.visibleInSearch,
    visibleInReports: !!def.visibleInReports,
    editableFromSheet: def.editableFromSheet !== false,
    editableFromPos: def.editableFromPos !== false,
    sortOrder: def.sortOrder ?? (existing.length + 1) * 10,
    active: true,
    storeId: STORE_ID,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  await setDoc(doc(db, COLLECTION, id), payload);
  await logAudit({ userId, action: 'FIELD_CREATED', module: 'config', recordId: id, newValue: payload, source: 'POS' });
  return id;
}

/** Deactivate (never physically delete) — section 6: don't lose historical data. */
export async function deactivateFieldDef(fieldId, userId) {
  await updateDoc(doc(db, COLLECTION, fieldId), { active: false, updatedAt: serverTimestamp() });
  await logAudit({ userId, action: 'FIELD_DEACTIVATED', module: 'config', recordId: fieldId, source: 'POS' });
}

export async function reactivateFieldDef(fieldId, userId) {
  await updateDoc(doc(db, COLLECTION, fieldId), { active: true, updatedAt: serverTimestamp() });
  await logAudit({ userId, action: 'FIELD_REACTIVATED', module: 'config', recordId: fieldId, source: 'POS' });
}

export async function updateFieldDef(fieldId, changes, userId) {
  await updateDoc(doc(db, COLLECTION, fieldId), { ...changes, updatedAt: serverTimestamp() });
  await logAudit({ userId, action: 'FIELD_UPDATED', module: 'config', recordId: fieldId, newValue: changes, source: 'POS' });
}

function slugify(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * One-time seed: run from Settings > Inventory Fields the first time a
 * store is set up. Idempotent — safe to call again, it skips fields that
 * already exist.
 */
export const DEFAULT_FIELD_SEED = [
  { fieldName: 'Flavour', fieldType: 'dropdown', options: [] },
  { fieldName: 'Rack Number', fieldType: 'text' },
  { fieldName: 'Manufacturer', fieldType: 'text' }
];
