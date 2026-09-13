/**
 * Built-in (always-present) product fields, section 5. This list is NOT
 * meant to be "the permanent schema" — it's the baseline the Dynamic Field
 * Engine (js/config/fieldSchema.js) extends. Adding a field here would
 * require a code change; that's deliberately only for the fields the spec
 * calls out as core to every retail product. Everything else is a custom
 * field added at runtime through Settings > Inventory Fields.
 */
export const BUILTIN_FIELDS = [
  { key: 'productId', label: 'Product ID', type: 'text', systemControlled: true },
  { key: 'barcode', label: 'Barcode', type: 'text' },
  { key: 'alternateBarcodes', label: 'Alternate Barcode(s)', type: 'multiselect' },
  { key: 'itemName', label: 'Item Name', type: 'text', required: true },
  { key: 'variant', label: 'Variant', type: 'text' },
  { key: 'brand', label: 'Brand', type: 'dropdown' },       // references brands/{id}
  { key: 'category', label: 'Category', type: 'dropdown' }, // references categories/{id}
  { key: 'subCategory', label: 'Sub Category', type: 'dropdown' },
  { key: 'unit', label: 'Unit', type: 'dropdown' },
  { key: 'purchasePrice', label: 'Purchase Price', type: 'currency' },
  { key: 'sellingPrice', label: 'Selling Price', type: 'currency' },
  { key: 'mrp', label: 'MRP', type: 'currency' },
  { key: 'gstPercent', label: 'GST %', type: 'percentage' },
  { key: 'hsn', label: 'HSN/SAC', type: 'text' },
  { key: 'imageUrl', label: 'Image URL', type: 'imageUrl' },
  { key: 'tags', label: 'Tags', type: 'multiselect' },
  { key: 'currentStock', label: 'Current Stock', type: 'number', systemControlled: true }, // via Stock Ledger only
  { key: 'minStock', label: 'Minimum Stock', type: 'number' },
  { key: 'maxStock', label: 'Maximum Stock', type: 'number' },
  { key: 'reorderLevel', label: 'Reorder Level', type: 'number' },
  { key: 'expiryDate', label: 'Expiry Date', type: 'date' },
  { key: 'batchNumber', label: 'Batch Number', type: 'text' },
  { key: 'supplierId', label: 'Supplier', type: 'dropdown' },
  { key: 'status', label: 'Status', type: 'dropdown', options: ['active', 'inactive', 'archived'], systemControlled: true }
];

export function emptyProductDraft() {
  return {
    productId: null,
    barcode: '',
    alternateBarcodes: [],
    itemName: '',
    variant: '',
    brand: '',
    category: '',
    subCategory: '',
    unit: '',
    purchasePrice: '',
    sellingPrice: '',
    mrp: '',
    gstPercent: '',
    hsn: '',
    imageUrl: '',
    tags: [],
    minStock: '',
    maxStock: '',
    reorderLevel: '',
    expiryDate: '',
    batchNumber: '',
    supplierId: '',
    status: 'active',
    customFields: {}
  };
}
