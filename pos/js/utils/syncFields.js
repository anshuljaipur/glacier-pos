export const NUMERIC_FIELDS = ['purchasePrice', 'sellingPrice', 'mrp', 'gstPercent', 'currentStock', 'minStock', 'maxStock', 'reorderLevel'];
export const LIST_FIELDS = ['tags', 'alternateBarcodes'];
export const DATE_FIELDS = ['expiryDate'];

// Firestore field key -> Sheet header name (README.md section 4 schema).
export const FIELD_TO_HEADER = {
  productId: 'Product ID',
  barcode: 'Barcode',
  alternateBarcodes: 'Alternate Barcodes',
  itemName: 'Item Name',
  variant: 'Variant',
  brand: 'Brand',
  category: 'Category',
  subCategory: 'Sub Category',
  unit: 'Unit',
  purchasePrice: 'Purchase Price',
  sellingPrice: 'Selling Price',
  mrp: 'MRP',
  gstPercent: 'GST %',
  hsn: 'HSN/SAC',
  imageUrl: 'Image URL',
  tags: 'Tags',
  currentStock: 'Current Stock',
  minStock: 'Minimum Stock',
  maxStock: 'Maximum Stock',
  reorderLevel: 'Reorder Level',
  expiryDate: 'Expiry Date',
  batchNumber: 'Batch Number',
  supplierId: 'Supplier',
  status: 'Status'
};

// Fields whose value is derived only through the Stock Ledger — sync
// treats a difference here as a Stock Adjustment, never a plain field
// UPDATE (README section 5 / spec sections 14-15).
export const LEDGER_CONTROLLED_FIELDS = ['currentStock'];

// Everything the content hash covers (i.e. everything sync cares about),
// excluding system-controlled columns (Product ID, Created/Updated Date,
// Sync Version, Last Sync, Firebase ID) which are metadata, not content.
export const SYNCED_FIELDS = Object.keys(FIELD_TO_HEADER).filter((f) => f !== 'productId');

/** Normalizes one field's value so the same content hashes identically
 * whether it originated as a Sheet cell string or a Firestore value. */
export function normalizeValue(fieldKey, rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return NUMERIC_FIELDS.includes(fieldKey) ? 0 : (LIST_FIELDS.includes(fieldKey) ? [] : '');
  }
  if (NUMERIC_FIELDS.includes(fieldKey)) {
    const n = Number(rawValue);
    return Number.isFinite(n) ? n : 0;
  }
  if (LIST_FIELDS.includes(fieldKey)) {
    const arr = Array.isArray(rawValue) ? rawValue : String(rawValue).split(',');
    return arr.map((v) => String(v).trim()).filter(Boolean).sort();
  }
  if (DATE_FIELDS.includes(fieldKey)) {
    const d = new Date(rawValue);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10); // YYYY-MM-DD
  }
  return String(rawValue).trim();
}

/** Builds the normalized { fieldKey: value } subset a content hash is computed over. */
export function buildSyncSubset(productLike) {
  const subset = {};
  for (const key of SYNCED_FIELDS) subset[key] = normalizeValue(key, productLike[key]);
  return subset;
}
