// Mirrors js/utils/syncFields.js. Keep the two in lockstep — this is the
// Node/CommonJS copy used by the sync Cloud Functions.

const NUMERIC_FIELDS = ['purchasePrice', 'sellingPrice', 'mrp', 'gstPercent', 'currentStock', 'minStock', 'maxStock', 'reorderLevel'];
const LIST_FIELDS = ['tags', 'alternateBarcodes'];
const DATE_FIELDS = ['expiryDate'];

const FIELD_TO_HEADER = {
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

const HEADER_TO_FIELD = Object.fromEntries(Object.entries(FIELD_TO_HEADER).map(([k, v]) => [v, k]));

const LEDGER_CONTROLLED_FIELDS = ['currentStock'];
const SYNCED_FIELDS = Object.keys(FIELD_TO_HEADER).filter((f) => f !== 'productId');

function normalizeValue(fieldKey, rawValue) {
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
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }
  return String(rawValue).trim();
}

function buildSyncSubset(productLike) {
  const subset = {};
  for (const key of SYNCED_FIELDS) subset[key] = normalizeValue(key, productLike[key]);
  return subset;
}

/** Converts a raw Sheet row (keyed by header name) into a { fieldKey: value } object. */
function sheetRowToFields(rowByHeader) {
  const out = {};
  for (const [header, value] of Object.entries(rowByHeader)) {
    const fieldKey = HEADER_TO_FIELD[header];
    if (fieldKey) out[fieldKey] = value;
  }
  return out;
}

module.exports = {
  NUMERIC_FIELDS, LIST_FIELDS, DATE_FIELDS, FIELD_TO_HEADER, HEADER_TO_FIELD,
  LEDGER_CONTROLLED_FIELDS, SYNCED_FIELDS, normalizeValue, buildSyncSubset, sheetRowToFields
};
