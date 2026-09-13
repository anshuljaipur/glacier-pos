import { collection, query, where, getDocs, limit } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase/init.js';

export function isNumeric(value) {
  return value !== '' && value !== null && !isNaN(Number(value));
}

export function isValidDate(value) {
  if (!value) return false;
  const d = new Date(value);
  return !isNaN(d.getTime());
}

export function isValidUrl(value) {
  if (!value) return true; // optional field
  try { new URL(value); return true; } catch { return false; }
}

export function isValidEmail(value) {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isValidMobile(value) {
  if (!value) return true;
  return /^[0-9]{7,15}$/.test(String(value).replace(/[\s-]/g, ''));
}

/** Checks no other *active* product already uses this barcode. */
export async function isBarcodeUnique(barcode, excludeProductId = null) {
  if (!barcode) return true;
  const q = query(collection(db, 'products'), where('barcode', '==', barcode), limit(5));
  const snap = await getDocs(q);
  return snap.docs.every((d) => d.id === excludeProductId);
}

/**
 * Validates a product payload against the required built-in fields plus
 * whatever the dynamic field schema (customFieldDefs) currently defines as
 * required — so validation stays correct as admins add fields, per the
 * "no hardcoded schema" principle (section 3).
 */
export function validateProduct(product, fieldDefs = []) {
  const errors = [];

  if (!product.itemName || !product.itemName.trim()) errors.push('Item Name is required.');
  if (product.mrp !== undefined && product.mrp !== '' && !isNumeric(product.mrp)) errors.push('MRP must be numeric.');
  if (product.sellingPrice !== undefined && product.sellingPrice !== '' && !isNumeric(product.sellingPrice)) errors.push('Selling Price must be numeric.');
  if (product.purchasePrice !== undefined && product.purchasePrice !== '' && !isNumeric(product.purchasePrice)) errors.push('Purchase Price must be numeric.');
  if (product.gstPercent !== undefined && product.gstPercent !== '' && !isNumeric(product.gstPercent)) errors.push('GST % must be numeric.');
  if (product.currentStock !== undefined && product.currentStock !== '' && !isNumeric(product.currentStock)) errors.push('Current Stock must be numeric.');
  if (product.expiryDate && !isValidDate(product.expiryDate)) errors.push('Expiry Date is not a valid date.');
  if (product.imageUrl && !isValidUrl(product.imageUrl)) errors.push('Image URL is not a valid URL.');

  // Note: selling price is intentionally allowed to be lower OR higher than
  // MRP — section 45 explicitly forbids assuming they must be equal.

  for (const def of fieldDefs.filter((f) => f.active)) {
    const value = product.customFields ? product.customFields[def.id] : undefined;
    if (def.required && (value === undefined || value === '' || value === null)) {
      errors.push(`${def.fieldName} is required.`);
      continue;
    }
    if (value === undefined || value === '' || value === null) continue;
    switch (def.fieldType) {
      case 'number':
      case 'currency':
      case 'percentage':
        if (!isNumeric(value)) errors.push(`${def.fieldName} must be numeric.`);
        break;
      case 'date':
      case 'datetime':
        if (!isValidDate(value)) errors.push(`${def.fieldName} is not a valid date.`);
        break;
      case 'url':
      case 'imageUrl':
        if (!isValidUrl(value)) errors.push(`${def.fieldName} is not a valid URL.`);
        break;
      case 'dropdown':
        if (def.options && !def.options.includes(value)) errors.push(`${def.fieldName} has an invalid option.`);
        break;
      default:
        break;
    }
  }

  return { valid: errors.length === 0, errors };
}
