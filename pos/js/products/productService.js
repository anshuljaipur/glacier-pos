import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, query, where,
  orderBy, limit, startAfter, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db, STORE_ID } from '../firebase/init.js';
import { allocateProductId } from '../utils/idGenerator.js';
import { validateProduct, isBarcodeUnique } from '../utils/validation.js';
import { getFieldDefs } from '../config/fieldSchema.js';
import { logAudit } from '../utils/auditLog.js';
import { hashSyncedFields } from '../utils/hash.js';
import { buildSyncSubset } from '../utils/syncFields.js';
import { applyStockChange } from '../inventory/stockLedger.js';

const COLLECTION = 'products';
const PAGE_SIZE = 25;

/**
 * Uses the canonical field list/normalization from utils/syncFields.js so a
 * hash computed here, in the Cloud Functions sync engine, and in Apps
 * Script all agree on what "changed" means for the same product (section 64).
 * customFields are intentionally NOT part of the content hash in Phase 6 —
 * the Sheet schema doesn't carry custom-field columns yet (that's the
 * "NEW COLUMN DETECTED" flow), so hashing them here would make every
 * product look permanently out of sync with the Sheet.
 */
function contentSubset(product) {
  return buildSyncSubset(product);
}

/**
 * Creates a new product. Allocates a permanent Product ID (never the item
 * name or barcode — section 4), validates against built-in rules plus
 * whatever custom fields are currently active, and — if an opening stock
 * quantity is given — records it through the Stock Ledger rather than
 * writing currentStock directly (section 16 applies from day one).
 */
export async function createProduct(draft, { userId, openingStock = 0 } = {}) {
  const fieldDefs = await getFieldDefs();
  const { valid, errors } = validateProduct(draft, fieldDefs);
  if (!valid) throw new ValidationError(errors);

  if (draft.barcode && !(await isBarcodeUnique(draft.barcode))) {
    throw new ValidationError([`Barcode ${draft.barcode} is already in use by another product.`]);
  }

  const productId = await allocateProductId();
  const contentHash = await hashSyncedFields(contentSubset(draft));

  const payload = {
    ...draft,
    productId,
    storeId: STORE_ID,
    currentStock: 0, // set to real value below via the ledger, never written raw
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: userId,
    updatedBy: userId,
    sync: {
      sheetRowId: null,
      lastSheetModifiedAt: null,
      lastFirebaseModifiedAt: serverTimestamp(),
      lastSyncedAt: null,
      lastModifiedSource: 'POS',
      syncVersion: 1,
      contentHash,
      syncStatus: 'pending',
      syncError: null
    }
  };

  await setDoc(doc(db, COLLECTION, productId), payload);

  if (Number(openingStock) > 0) {
    await applyStockChange({
      productId, type: 'OPENING', quantityChange: Number(openingStock),
      source: 'POS', userId, remarks: 'Opening stock at product creation.'
    });
  }

  await logAudit({ userId, action: 'PRODUCT_CREATED', module: 'products', recordId: productId, newValue: payload, source: 'POS' });
  return productId;
}

/**
 * Updates a product's master fields (never currentStock — use stockLedger
 * for that). Bumps syncVersion/contentHash and stamps lastModifiedSource so
 * the sync engine knows this change originated in POS.
 */
export async function updateProduct(productId, changes, { userId }) {
  if ('currentStock' in changes) {
    throw new Error('currentStock cannot be set directly — use applyStockChange().');
  }

  const fieldDefs = await getFieldDefs();
  const ref = doc(db, COLLECTION, productId);
  const existingSnap = await getDoc(ref);
  if (!existingSnap.exists()) throw new Error(`Product ${productId} not found.`);
  const existing = existingSnap.data();

  const merged = { ...existing, ...changes, customFields: { ...existing.customFields, ...(changes.customFields || {}) } };
  const { valid, errors } = validateProduct(merged, fieldDefs);
  if (!valid) throw new ValidationError(errors);

  if (changes.barcode && changes.barcode !== existing.barcode && !(await isBarcodeUnique(changes.barcode, productId))) {
    throw new ValidationError([`Barcode ${changes.barcode} is already in use by another product.`]);
  }

  const contentHash = await hashSyncedFields(contentSubset(merged));

  await updateDoc(ref, {
    ...changes,
    updatedAt: serverTimestamp(),
    updatedBy: userId,
    'sync.lastFirebaseModifiedAt': serverTimestamp(),
    'sync.lastModifiedSource': 'POS',
    'sync.syncVersion': (existing.sync?.syncVersion || 1) + 1,
    'sync.contentHash': contentHash,
    'sync.syncStatus': 'pending'
  });

  for (const [field, newValue] of Object.entries(changes)) {
    if (field === 'customFields') continue;
    if (existing[field] !== newValue) {
      await logAudit({ userId, action: `${field.toUpperCase()}_UPDATED`, module: 'products', recordId: productId, field, oldValue: existing[field] ?? null, newValue, source: 'POS' });
    }
  }

  return productId;
}

/** Section 18: never a hard delete when history exists — always a status change. */
export async function setProductStatus(productId, status, { userId, reason = '' }) {
  if (!['active', 'inactive', 'archived'].includes(status)) throw new Error(`Invalid status: ${status}`);
  const ref = doc(db, COLLECTION, productId);
  const existing = (await getDoc(ref)).data();
  await updateDoc(ref, {
    status, updatedAt: serverTimestamp(), updatedBy: userId,
    'sync.lastFirebaseModifiedAt': serverTimestamp(), 'sync.lastModifiedSource': 'POS', 'sync.syncStatus': 'pending'
  });
  await logAudit({ userId, action: 'STATUS_CHANGED', module: 'products', recordId: productId, field: 'status', oldValue: existing?.status, newValue: status, source: 'POS' });
}

export async function getProduct(productId) {
  const snap = await getDoc(doc(db, COLLECTION, productId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** Fast barcode lookup for the POS scanner flow (section 46). */
export async function findByBarcode(barcode) {
  const q = query(collection(db, COLLECTION), where('barcode', '==', barcode), limit(5));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Paginated product list — never loads the whole catalog (section 47). */
export async function listProducts({ status = 'active', category = null, cursor = null, pageSize = PAGE_SIZE } = {}) {
  const clauses = [where('status', '==', status)];
  if (category) clauses.push(where('category', '==', category));
  let q = query(collection(db, COLLECTION), ...clauses, orderBy('itemName'), limit(pageSize));
  if (cursor) q = query(collection(db, COLLECTION), ...clauses, orderBy('itemName'), startAfter(cursor), limit(pageSize));
  const snap = await getDocs(q);
  return {
    products: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
    nextCursor: snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1] : null
  };
}

export class ValidationError extends Error {
  constructor(errors) {
    super(errors.join(' '));
    this.name = 'ValidationError';
    this.errors = errors;
  }
}
