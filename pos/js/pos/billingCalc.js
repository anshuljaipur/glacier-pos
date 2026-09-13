function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

/**
 * @param {{qty:number, rate:number, discountAmount?:number, gstPercent?:number}} item
 * Discount is applied before GST (common retail practice) — a documented
 * simplification; a future Accounting/GST module (section 38/78 Phase 8)
 * can refine this if the business needs discount-after-tax reporting.
 */
export function computeLine(item) {
  const qty = Number(item.qty) || 0;
  const rate = Number(item.rate) || 0;
  const discount = Number(item.discountAmount) || 0;
  const gstPercent = Number(item.gstPercent) || 0;

  const gross = qty * rate;
  const taxableValue = Math.max(0, gross - discount);
  const gstAmount = taxableValue * (gstPercent / 100);
  const lineTotal = taxableValue + gstAmount;

  return { taxableValue: round2(taxableValue), gstAmount: round2(gstAmount), lineTotal: round2(lineTotal) };
}

/**
 * @param {Array<{taxableValue:number, gstAmount:number}>} computedLines
 * @param {number} billDiscount flat amount taken off the grand total
 */
export function computeBill(computedLines, billDiscount = 0) {
  const subtotal = computedLines.reduce((s, l) => s + l.taxableValue, 0);
  const tax = computedLines.reduce((s, l) => s + l.gstAmount, 0);
  const grossTotal = subtotal + tax;
  const grandTotal = Math.max(0, round2(grossTotal - (Number(billDiscount) || 0)));
  return { subtotal: round2(subtotal), tax: round2(tax), billDiscount: round2(billDiscount || 0), grandTotal };
}

export function sumPayments(paymentDetails) {
  return round2((paymentDetails || []).reduce((s, p) => s + (Number(p.amount) || 0), 0));
}

export { round2 };
