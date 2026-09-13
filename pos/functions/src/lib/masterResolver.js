const admin = require('firebase-admin');

const REFERENCE_FIELDS = {
  category: 'categories',
  subCategory: 'subCategories',
  brand: 'brands',
  unit: 'units',
  supplierId: 'suppliers'
};

const AUTO_CREATE_COLLECTIONS = ['categories', 'subCategories', 'brands', 'units'];

function slugify(name) {
  return String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** One query per master collection per sync run, then all lookups are in-memory. */
async function loadMasterMaps(db) {
  const maps = {};
  await Promise.all(Object.values(REFERENCE_FIELDS).map(async (collectionName) => {
    const snap = await db.collection(collectionName).get();
    const byId = new Map();
    const byNameLower = new Map();
    snap.forEach((doc) => {
      const name = doc.data().name || '';
      byId.set(doc.id, name);
      if (name) byNameLower.set(name.trim().toLowerCase(), doc.id);
    });
    maps[collectionName] = { byId, byNameLower };
  }));
  return maps;
}

/**
 * @returns {Promise<string|null>} the master's ID, or null if not found and
 * this collection isn't auto-create (i.e. suppliers) — caller decides how
 * to handle a null.
 */
async function resolveNameToId(db, maps, collectionName, rawName) {
  const trimmed = String(rawName || '').trim();
  if (!trimmed) return '';
  const map = maps[collectionName];
  const existing = map.byNameLower.get(trimmed.toLowerCase());
  if (existing) return existing;
  if (!AUTO_CREATE_COLLECTIONS.includes(collectionName)) return null;

  const id = slugify(trimmed);
  await db.collection(collectionName).doc(id).set({
    name: trimmed, active: true, storeId: 'store-001', createdBy: 'sync',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  map.byId.set(id, trimmed);
  map.byNameLower.set(trimmed.toLowerCase(), id);
  return id;
}

function idToName(maps, collectionName, id) {
  if (!id) return '';
  return maps[collectionName]?.byId.get(id) || '';
}

/**
 * Replaces the five reference fields on a raw Sheet row (which hold plain
 * text like "Biscuits") with the matching Firestore master IDs, so the rest
 * of the sync engine can compare/store them exactly like every other field.
 * Everything else on `fields` passes through unchanged.
 */
async function resolveRowReferenceFields(db, maps, fields) {
  const resolved = { ...fields };
  const warnings = [];
  for (const [fieldKey, collectionName] of Object.entries(REFERENCE_FIELDS)) {
    const rawName = fields[fieldKey];
    if (!rawName) { resolved[fieldKey] = ''; continue; }
    const id = await resolveNameToId(db, maps, collectionName, rawName);
    if (id === null) {
      warnings.push(`${collectionName === 'suppliers' ? 'Supplier' : collectionName} "${rawName}" was not found — left unset for "${fields.itemName || fields.barcode || 'this row'}".`);
      resolved[fieldKey] = '';
    } else {
      resolved[fieldKey] = id;
    }
  }
  return { resolved, warnings };
}

/** Converts one Firestore field value into the plain-text form a Sheet cell should show. */
function toSheetCellValue(fieldKey, value, maps, { LIST_FIELDS }) {
  const collectionName = REFERENCE_FIELDS[fieldKey];
  if (collectionName) return idToName(maps, collectionName, value);
  if (LIST_FIELDS.includes(fieldKey)) return Array.isArray(value) ? value.join(', ') : (value || '');
  return value === undefined || value === null ? '' : value;
}

module.exports = {
  REFERENCE_FIELDS, AUTO_CREATE_COLLECTIONS, slugify,
  loadMasterMaps, resolveNameToId, idToName, resolveRowReferenceFields, toSheetCellValue
};
