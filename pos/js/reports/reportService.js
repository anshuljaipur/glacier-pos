import { collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase/init.js';
import { round2 } from '../pos/billingCalc.js';

// ---------- Raw fetches ----------

export async function getSalesInRange(fromMs, toMs) {
  const snap = await getDocs(query(collection(db, 'sales'), where('clientSeq', '>=', fromMs), where('clientSeq', '<=', toMs)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getPurchasesInRange(fromMs, toMs) {
  const snap = await getDocs(query(collection(db, 'purchases'), where('clientSeq', '>=', fromMs), where('clientSeq', '<=', toMs)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function getAllDocs(collectionName) {
  const snap = await getDocs(collection(db, collectionName));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function inRange(dateTime, fromMs, toMs) {
  const ms = dateTime?.toDate ? dateTime.toDate().getTime() : null;
  return ms !== null && ms >= fromMs && ms <= toMs;
}

export async function getSalesReturnsInRange(fromMs, toMs) {
  const all = await getAllDocs('salesReturns');
  return all.filter((r) => inRange(r.dateTime, fromMs, toMs));
}

export async function getPurchaseReturnsInRange(fromMs, toMs) {
  const all = await getAllDocs('purchaseReturns');
  return all.filter((r) => inRange(r.dateTime, fromMs, toMs));
}

export async function getAllActiveProducts() {
  const snap = await getDocs(query(collection(db, 'products'), where('status', '==', 'active')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ---------- Aggregations ----------

export function computeSalesSummary(sales) {
  const billCount = sales.length;
  const subtotal = round2(sales.reduce((s, x) => s + (x.subtotal || 0), 0));
  const discount = round2(sales.reduce((s, x) => s + (x.billDiscount || 0), 0));
  const tax = round2(sales.reduce((s, x) => s + (x.tax || 0), 0));
  const grandTotal = round2(sales.reduce((s, x) => s + (x.grandTotal || 0), 0));
  return [{ 'Bills': billCount, 'Subtotal': subtotal, 'Discount': discount, 'GST': tax, 'Grand Total': grandTotal }];
}

export function computePaymentModeBreakdown(sales) {
  const byMode = {};
  for (const sale of sales) {
    for (const p of sale.paymentDetails || []) {
      byMode[p.method] = (byMode[p.method] || 0) + (Number(p.amount) || 0);
    }
  }
  return Object.entries(byMode).map(([method, amount]) => ({ 'Payment Mode': method, 'Amount': round2(amount) }));
}

export function computeProductSales(sales) {
  const byProduct = {};
  for (const sale of sales) {
    for (const item of sale.items) {
      const key = item.productId;
      if (!byProduct[key]) byProduct[key] = { name: item.itemNameSnapshot, qty: 0, revenue: 0 };
      byProduct[key].qty += item.qty;
      byProduct[key].revenue += item.lineTotal;
    }
  }
  return Object.values(byProduct)
    .sort((a, b) => b.revenue - a.revenue)
    .map((p) => ({ 'Item': p.name, 'Qty Sold': p.qty, 'Revenue': round2(p.revenue) }));
}

function groupSalesByProductAttr(sales, products, attrKey, masterLookup) {
  const productById = new Map(products.map((p) => [p.productId, p]));
  const byGroup = {};
  for (const sale of sales) {
    for (const item of sale.items) {
      const product = productById.get(item.productId);
      const groupId = product ? product[attrKey] : null;
      const groupName = groupId ? (masterLookup.get(groupId) || groupId) : '(unassigned)';
      byGroup[groupName] = (byGroup[groupName] || 0) + item.lineTotal;
    }
  }
  return Object.entries(byGroup).sort((a, b) => b[1] - a[1]).map(([name, revenue]) => ({ 'Name': name, 'Revenue': round2(revenue) }));
}

export function computeCategorySales(sales, products, categories) {
  const lookup = new Map(categories.map((c) => [c.id, c.name]));
  return groupSalesByProductAttr(sales, products, 'category', lookup).map((r) => ({ 'Category': r.Name, 'Revenue': r.Revenue }));
}

export function computeBrandSales(sales, products, brands) {
  const lookup = new Map(brands.map((b) => [b.id, b.name]));
  return groupSalesByProductAttr(sales, products, 'brand', lookup).map((r) => ({ 'Brand': r.Name, 'Revenue': r.Revenue }));
}

export function computeDiscountReport(sales) {
  const lineDiscounts = round2(sales.reduce((s, sale) => s + sale.items.reduce((ss, i) => ss + (i.discountAmount || 0), 0), 0));
  const billDiscounts = round2(sales.reduce((s, sale) => s + (sale.billDiscount || 0), 0));
  return [{ 'Line Discounts': lineDiscounts, 'Bill Discounts': billDiscounts, 'Total Discount': round2(lineDiscounts + billDiscounts) }];
}

export function computeCustomerReport(sales, customers) {
  const nameById = new Map(customers.map((c) => [c.id, c.name]));
  const byCustomer = {};
  for (const sale of sales) {
    const key = sale.customerId || '(walk-in)';
    if (!byCustomer[key]) byCustomer[key] = { bills: 0, total: 0 };
    byCustomer[key].bills++;
    byCustomer[key].total += sale.grandTotal;
  }
  return Object.entries(byCustomer)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([id, v]) => ({ 'Customer': id === '(walk-in)' ? 'Walk-in' : (nameById.get(id) || id), 'Bills': v.bills, 'Total': round2(v.total) }));
}

export function computeSupplierReport(purchases, suppliers) {
  const nameById = new Map(suppliers.map((s) => [s.id, s.name]));
  const bySupplier = {};
  for (const p of purchases) {
    const key = p.supplierId;
    if (!bySupplier[key]) bySupplier[key] = { bills: 0, total: 0 };
    bySupplier[key].bills++;
    bySupplier[key].total += p.grandTotal;
  }
  return Object.entries(bySupplier)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([id, v]) => ({ 'Supplier': nameById.get(id) || id, 'Bills': v.bills, 'Total': round2(v.total) }));
}

export function computeStockValuation(products) {
  const rows = products.map((p) => ({
    'Item': p.itemName, 'Stock': p.currentStock || 0, 'Purchase Price': p.purchasePrice || 0,
    'Value': round2((p.currentStock || 0) * (p.purchasePrice || 0))
  }));
  const total = round2(rows.reduce((s, r) => s + r.Value, 0));
  rows.push({ 'Item': 'TOTAL', 'Stock': '', 'Purchase Price': '', 'Value': total });
  return rows;
}

export function computeLowStock(products) {
  return products.filter((p) => p.reorderLevel && Number(p.currentStock || 0) <= Number(p.reorderLevel) && Number(p.currentStock || 0) > 0)
    .map((p) => ({ 'Item': p.itemName, 'Stock': p.currentStock, 'Reorder Level': p.reorderLevel }));
}

export function computeOutOfStock(products) {
  return products.filter((p) => Number(p.currentStock || 0) === 0).map((p) => ({ 'Item': p.itemName, 'Stock': 0 }));
}

export function computeExpiry(products, withinDays = null) {
  const now = new Date();
  return products.filter((p) => p.expiryDate).map((p) => {
    const days = Math.ceil((new Date(p.expiryDate) - now) / 86400000);
    return { ...p, _daysToExpiry: days };
  }).filter((p) => withinDays === null ? p._daysToExpiry < 0 : (p._daysToExpiry >= 0 && p._daysToExpiry <= withinDays))
    .map((p) => ({ 'Item': p.itemName, 'Expiry Date': p.expiryDate, 'Days': p._daysToExpiry, 'Stock': p.currentStock || 0 }));
}

/**
 * GST summary: output tax collected on sales vs input tax paid on
 * purchases, grouped by HSN. This is a summary for bookkeeping reference,
 * not a filed-return generator — actual GST filing (section 65's future
 * "GST filing" module) needs far more than this.
 */
export function computeGstSummary(sales, purchases) {
  const byHsn = {};
  for (const sale of sales) {
    for (const item of sale.items) {
      const key = item.hsn || '(no HSN)';
      if (!byHsn[key]) byHsn[key] = { outputTax: 0, inputTax: 0 };
      byHsn[key].outputTax += item.gstAmount || 0;
    }
  }
  for (const purchase of purchases) {
    for (const item of purchase.items) {
      const key = item.hsn || '(no HSN)';
      if (!byHsn[key]) byHsn[key] = { outputTax: 0, inputTax: 0 };
      byHsn[key].inputTax += item.gstAmount || 0;
    }
  }
  return Object.entries(byHsn).map(([hsn, v]) => ({
    'HSN': hsn, 'Output Tax (Sales)': round2(v.outputTax), 'Input Tax (Purchases)': round2(v.inputTax),
    'Net Payable': round2(v.outputTax - v.inputTax)
  }));
}

/**
 * Approximate margin: revenue minus (qty × the product's CURRENT
 * purchasePrice), not the price actually paid on the purchase that
 * fulfilled that specific sale (no cost-lot/FIFO tracking exists — that
 * would need per-batch cost tracking, which section 14's simple Stock
 * Ledger doesn't carry). Good enough for a rough margin sense, not for
 * accounting-grade COGS.
 */
export function computeProfitMargin(sales, products) {
  const productById = new Map(products.map((p) => [p.productId, p]));
  const byProduct = {};
  for (const sale of sales) {
    for (const item of sale.items) {
      if (!byProduct[item.productId]) byProduct[item.productId] = { name: item.itemNameSnapshot, revenue: 0, cost: 0, qty: 0 };
      const cost = (productById.get(item.productId)?.purchasePrice || 0) * item.qty;
      byProduct[item.productId].revenue += item.lineTotal;
      byProduct[item.productId].cost += cost;
      byProduct[item.productId].qty += item.qty;
    }
  }
  return Object.values(byProduct).map((p) => ({
    'Item': p.name, 'Qty': p.qty, 'Revenue': round2(p.revenue), 'Est. Cost': round2(p.cost), 'Est. Margin': round2(p.revenue - p.cost)
  }));
}

export function computeSalesReturnReport(returns) {
  return returns.map((r) => ({ 'Invoice #': r.invoiceNumber || '—', 'Reason': r.reason || '—', 'Total': round2(r.grandTotal) }));
}

export function computePurchaseReturnReport(returns) {
  return returns.map((r) => ({ 'Purchase ID': r.purchaseId, 'Reason': r.reason || '—', 'Total': round2(r.grandTotal) }));
}

// ---------- Export ----------

export function toCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escapeCell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => escapeCell(r[h])).join(','))].join('\n');
}

export function downloadCsv(filename, rows) {
  const csv = toCsv(rows);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
