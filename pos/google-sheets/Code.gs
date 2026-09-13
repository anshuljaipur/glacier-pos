/**
 * Apps Script API layer for the Inventory sheet — Phase 6 (README.md
 * section 5). This is the ONLY thing that reads/writes the spreadsheet;
 * the Cloud Functions sync engine never touches Sheets directly, and the
 * POS frontend never touches Sheets or this script directly either
 * (section 48). Every request must carry the shared secret configured in
 * Script Properties as SYNC_SHARED_SECRET, matching the Cloud Functions
 * secret of the same name — this is the "signed request" mentioned in the
 * architecture doc, since a Web App URL alone is not a credential.
 *
 * NOTE: the field-mapping/normalization logic below mirrors
 * js/utils/syncFields.js and functions/src/lib/syncFields.js byte-for-byte
 * in intent. Keep all three in lockstep — see those files' header comments.
 */

const INVENTORY_SHEET_NAME = 'Inventory';
const SYNC_LOG_SHEET_NAME = 'Sync Log';

const FIELD_TO_HEADER = {
  barcode: 'Barcode', alternateBarcodes: 'Alternate Barcodes', itemName: 'Item Name',
  variant: 'Variant', brand: 'Brand', category: 'Category', subCategory: 'Sub Category',
  unit: 'Unit', purchasePrice: 'Purchase Price', sellingPrice: 'Selling Price', mrp: 'MRP',
  gstPercent: 'GST %', hsn: 'HSN/SAC', imageUrl: 'Image URL', tags: 'Tags',
  currentStock: 'Current Stock', minStock: 'Minimum Stock', maxStock: 'Maximum Stock',
  reorderLevel: 'Reorder Level', expiryDate: 'Expiry Date', batchNumber: 'Batch Number',
  supplierId: 'Supplier', status: 'Status'
};
const HEADER_TO_FIELD = invert_(FIELD_TO_HEADER);
const NUMERIC_FIELDS = ['purchasePrice', 'sellingPrice', 'mrp', 'gstPercent', 'currentStock', 'minStock', 'maxStock', 'reorderLevel'];
const LIST_FIELDS = ['tags', 'alternateBarcodes'];
const DATE_FIELDS = ['expiryDate'];
const SYSTEM_COLUMNS = ['Product ID', 'Created Date', 'Updated Date', 'Sync Version', 'Last Sync', 'Firebase ID'];
const KNOWN_HEADERS = ['Product ID'].concat(Object.values(FIELD_TO_HEADER)).concat(SYSTEM_COLUMNS.filter((h) => h !== 'Product ID'));

function invert_(obj) {
  const out = {};
  for (const k in obj) out[obj[k]] = k;
  return out;
}

function checkSecret_(e) {
  const expected = PropertiesService.getScriptProperties().getProperty('SYNC_SHARED_SECRET');
  const given = e.parameter.secret;
  if (!expected || given !== expected) {
    throw new Error('Unauthorized: missing or invalid sync secret.');
  }
}

function normalizeValue_(fieldKey, rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return NUMERIC_FIELDS.indexOf(fieldKey) !== -1 ? 0 : (LIST_FIELDS.indexOf(fieldKey) !== -1 ? [] : '');
  }
  if (NUMERIC_FIELDS.indexOf(fieldKey) !== -1) {
    const n = Number(rawValue);
    return isNaN(n) ? 0 : n;
  }
  if (LIST_FIELDS.indexOf(fieldKey) !== -1) {
    const arr = String(rawValue).split(',');
    return arr.map(function (v) { return v.trim(); }).filter(function (v) { return v; }).sort();
  }
  if (DATE_FIELDS.indexOf(fieldKey) !== -1) {
    const d = new Date(rawValue);
    if (isNaN(d.getTime())) return '';
    return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
  }
  return String(rawValue).trim();
}

/** Same algorithm as js/utils/hash.js / functions/src/lib/hash.js: sort keys, JSON.stringify, SHA-256 hex. */
function hashSyncedFields_(obj) {
  const keys = Object.keys(obj).sort();
  const sorted = {};
  for (const k of keys) sorted[k] = obj[k];
  const json = JSON.stringify(sorted);
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, json, Utilities.Charset.UTF_8);
  return digest.map(function (b) {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function getSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(INVENTORY_SHEET_NAME);
  if (!sheet) throw new Error('Sheet tab "' + INVENTORY_SHEET_NAME + '" not found.');
  return sheet;
}

function getHeaderMap_(sheet) {
  const lastCol = sheet.getLastColumn();
  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {}; // header -> 1-based column index
  headerRow.forEach(function (h, i) {
    const header = String(h).trim();
    if (header) map[header] = i + 1;
  });
  return map;
}

function getSheetSchema() {
  const sheet = getSheet_();
  const headerMap = getHeaderMap_(sheet);
  const present = Object.keys(headerMap);
  const missing = KNOWN_HEADERS.filter(function (h) { return present.indexOf(h) === -1; });
  const unexpected = present.filter(function (h) { return KNOWN_HEADERS.indexOf(h) === -1; });
  return { columns: present, missing: missing, unexpected: unexpected, systemControlled: SYSTEM_COLUMNS };
}

/**
 * Reads every data row, computes a content hash per row over the same
 * normalized field subset the Cloud Functions/POS side hashes, and returns
 * it all in one batch call — this is what previewSync/syncNow consume.
 */
function getInventoryWithHashes() {
  const sheet = getSheet_();
  const headerMap = getHeaderMap_(sheet);
  const schema = getSheetSchema();
  const lastRow = sheet.getLastRow();
  const rows = [];

  if (lastRow >= 2) {
    const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    values.forEach(function (rowValues, i) {
      if (!rowValues.some(function (c) { return c !== ''; })) return; // skip blank rows
      const rowIndex = i + 2; // 1-based sheet row number
      const productId = headerMap['Product ID'] ? String(rowValues[headerMap['Product ID'] - 1]).trim() : '';
      const fields = {};
      for (const fieldKey in FIELD_TO_HEADER) {
        const header = FIELD_TO_HEADER[fieldKey];
        const col = headerMap[header];
        fields[fieldKey] = col ? rowValues[col - 1] : '';
      }
      const normalized = {};
      for (const fieldKey in fields) normalized[fieldKey] = normalizeValue_(fieldKey, fields[fieldKey]);
      rows.push({
        rowIndex: rowIndex,
        productId: productId || null,
        fields: fields,
        contentHash: hashSyncedFields_(normalized)
      });
    });
  }

  return { rows: rows, newColumns: schema.unexpected, missingColumns: schema.missing };
}

/**
 * Applies a batch of row writes. Each entry:
 *   { productId, isNewRow, rowIndex?, valuesByHeader: { 'Item Name': 'ABC', ... } }
 * Rows are located by Product ID (never by position — section 40/41);
 * rowIndex is an optimization hint from the last read, re-validated by
 * looking up the Product ID column before writing.
 */
function applyWrites_(rows) {
  const sheet = getSheet_();
  const headerMap = getHeaderMap_(sheet);
  const productIdCol = headerMap['Product ID'];
  if (!productIdCol) throw new Error('Product ID column not found — cannot safely locate rows.');

  const lastRow = sheet.getLastRow();
  const idColumnValues = lastRow >= 2 ? sheet.getRange(2, productIdCol, lastRow - 1, 1).getValues() : [];
  const results = [];

  rows.forEach(function (write) {
    let targetRow = null;
    if (!write.isNewRow) {
      for (let i = 0; i < idColumnValues.length; i++) {
        if (String(idColumnValues[i][0]).trim() === write.productId) { targetRow = i + 2; break; }
      }
    }
    if (targetRow === null) {
      targetRow = sheet.getLastRow() + 1; // append
    }
    for (const header in write.valuesByHeader) {
      const col = headerMap[header];
      if (!col) continue; // unknown header — surfaced separately via getSheetSchema's "unexpected", not written blind
      sheet.getRange(targetRow, col).setValue(write.valuesByHeader[header]);
    }
    results.push({ productId: write.productId, rowIndex: targetRow });
  });

  return { applied: results };
}

function writeSyncLog_(entry) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SYNC_LOG_SHEET_NAME);
  if (!sheet) return { skipped: true, reason: 'Sync Log tab not present' };
  sheet.appendRow([
    entry.dateTime || new Date().toISOString(), entry.syncId || '', entry.productsAdded || 0,
    entry.productsUpdated || 0, entry.stockAdjustments || 0, entry.conflicts || 0,
    (entry.errors && entry.errors.length) || 0, entry.userId || ''
  ]);
  return { ok: true };
}

function doGet(e) {
  try {
    checkSecret_(e);
    const action = e.parameter.action;
    let result;
    if (action === 'getSheetSchema') result = getSheetSchema();
    else if (action === 'getInventoryWithHashes') result = getInventoryWithHashes();
    else result = { error: 'Unknown action: ' + action };
    return jsonOut_(result);
  } catch (err) {
    return jsonOut_({ error: err.message });
  }
}

function doPost(e) {
  try {
    checkSecret_(e);
    const action = e.parameter.action;
    const body = JSON.parse(e.postData.contents || '{}');
    let result;
    if (action === 'applyWrites') result = applyWrites_(body.rows || []);
    else if (action === 'writeSyncLog') result = writeSyncLog_(body);
    else if (action === 'mirrorMasterTab') result = mirrorMasterTab_(body.tabName, body.headers, body.rows || []);
    else result = { error: 'Unknown action: ' + action };
    return jsonOut_(result);
  } catch (err) {
    return jsonOut_({ error: err.message });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * One-time setup helper — run manually from the Apps Script editor once
 * after pasting this file in, to generate and store the shared secret this
 * script and the Cloud Functions secret must both hold. Run it, copy the
 * logged value, then `firebase functions:secrets:set SYNC_SHARED_SECRET`
 * with that same value.
 */
function setup_generateSharedSecret() {
  const existing = PropertiesService.getScriptProperties().getProperty('SYNC_SHARED_SECRET');
  if (existing) { Logger.log('SYNC_SHARED_SECRET already set.'); return; }
  const secret = Utilities.getUuid() + Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty('SYNC_SHARED_SECRET', secret);
  Logger.log('Generated SYNC_SHARED_SECRET: ' + secret);
}

/**
 * ============================================================
 * Phase 5 — workbook setup, formatting, and read-only master tabs
 * ============================================================
 *
 * Scoping note (documented rather than silently assumed): section 73
 * lists Categories/Brands/Subcategories/Units/Suppliers/Customers as
 * Sheet tabs. The Inventory tab's Category/Brand/Sub Category/Unit/
 * Supplier columns are already the real two-way-relevant write surface —
 * masterResolver.js (Cloud Functions) resolves those plain-text cells
 * against Firestore and creates new master records on sight (section 62).
 * Making these OTHER six tabs independently two-way-editable would mean
 * building and maintaining six more hash/conflict-detection pipelines
 * identical to the Inventory one for very little added benefit, since
 * Categories/Brands/Units/Suppliers/Customers already have real management
 * UIs in the POS app (masters.html, suppliers.html, customers.html). So
 * these six tabs are mirrored ONE-WAY, Firebase -> Sheet, as a read-only
 * reference/lookup view for whoever is managing the Inventory tab — not
 * a second editable copy that could drift from the app.
 */

const MASTER_MIRROR_HEADERS = {
  'Categories': ['Name', 'Active', 'Created Date'],
  'Brands': ['Name', 'Active', 'Created Date'],
  'Subcategories': ['Name', 'Parent Category', 'Active', 'Created Date'],
  'Units': ['Name', 'Active', 'Created Date'],
  'Suppliers': ['Supplier ID', 'Name', 'Mobile', 'Email', 'Address', 'GSTIN', 'Payment Terms', 'Status'],
  'Customers': ['Customer ID', 'Name', 'Mobile', 'Email', 'Address', 'GSTIN', 'Credit Limit', 'Status']
};

/** Clears and rewrites a mirror tab's data — these tabs are managed
 * entirely by the sync engine, never hand-edited, so a full rewrite (not
 * a by-key upsert like applyWrites_) is the correct, simplest approach. */
function mirrorMasterTab_(tabName, headers, rows) {
  if (!MASTER_MIRROR_HEADERS[tabName]) return { error: 'Unknown mirror tab: ' + tabName };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(tabName);
  if (!sheet) sheet = ss.insertSheet(tabName);

  const useHeaders = headers && headers.length ? headers : MASTER_MIRROR_HEADERS[tabName];
  sheet.clear();
  sheet.getRange(1, 1, 1, useHeaders.length).setValues([useHeaders]).setFontWeight('bold');
  sheet.setFrozenRows(1);

  if (rows.length) {
    const values = rows.map(function (row) { return useHeaders.map(function (h) { return row[h] !== undefined ? row[h] : ''; }); });
    sheet.getRange(2, 1, values.length, useHeaders.length).setValues(values);
  }
  sheet.autoResizeColumns(1, useHeaders.length);
  return { ok: true, tab: tabName, rowCount: rows.length };
}

/**
 * Run once from the Apps Script editor (or re-run any time — it's
 * idempotent) to build the full multi-tab workbook: creates any missing
 * tabs, freezes the Inventory header row, adds a Status dropdown, protects
 * the system-controlled columns from manual edits (section 72), adds
 * conditional formatting for low stock and expiry, and writes an
 * Instructions tab. This is Sheet formatting/structure, not sync logic —
 * nothing here talks to Firebase.
 */
function setup_formatWorkbook() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // --- Inventory tab: freeze header, Status dropdown, protect system columns, conditional formatting ---
  const inv = ss.getSheetByName(INVENTORY_SHEET_NAME);
  if (inv) {
    inv.setFrozenRows(1);
    const headerMap = getHeaderMap_(inv);

    if (headerMap['Status']) {
      const statusRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(['active', 'inactive', 'archived'], true)
        .setAllowInvalid(false)
        .build();
      inv.getRange(2, headerMap['Status'], Math.max(inv.getMaxRows() - 1, 1), 1).setDataValidation(statusRule);
    }

    SYSTEM_COLUMNS.forEach(function (colName) {
      const col = headerMap[colName];
      if (!col) return;
      const range = inv.getRange(1, col, inv.getMaxRows(), 1);
      const protection = range.protect().setDescription('System-controlled: ' + colName);
      protection.setWarningOnly(true); // warns editors rather than hard-blocking, since a store owner may legitimately need to fix a bad sync once
    });

    if (headerMap['Current Stock'] && headerMap['Reorder Level']) {
      const stockCol = columnLetter_(headerMap['Current Stock']);
      const reorderCol = columnLetter_(headerMap['Reorder Level']);
      const lowStockRule = SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND($' + stockCol + '2<>"", $' + reorderCol + '2<>"", $' + stockCol + '2<=$' + reorderCol + '2)')
        .setBackground('#F3E9D6')
        .setRanges([inv.getRange(2, headerMap['Current Stock'], Math.max(inv.getMaxRows() - 1, 1), 1)])
        .build();
      const rules = inv.getConditionalFormatRules();
      rules.push(lowStockRule);
      inv.setConditionalFormatRules(rules);
    }

    if (headerMap['Expiry Date']) {
      const expCol = columnLetter_(headerMap['Expiry Date']);
      const expiredRule = SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND($' + expCol + '2<>"", $' + expCol + '2<TODAY())')
        .setBackground('#F6E7E4')
        .setRanges([inv.getRange(2, headerMap['Expiry Date'], Math.max(inv.getMaxRows() - 1, 1), 1)])
        .build();
      const rules2 = inv.getConditionalFormatRules();
      rules2.push(expiredRule);
      inv.setConditionalFormatRules(rules2);
    }
  }

  // --- Create any missing structural tabs with header rows ---
  const structuralTabs = {
    'Sync Log': ['Date', 'Sync ID', 'Added', 'Updated', 'Stock Adjustments', 'Conflicts', 'Errors', 'User'],
    'Sync Status': ['Metric', 'Value']
  };
  Object.keys(structuralTabs).forEach(function (name) { ensureTab_(name, structuralTabs[name]); });
  Object.keys(MASTER_MIRROR_HEADERS).forEach(function (name) { ensureTab_(name, MASTER_MIRROR_HEADERS[name]); });

  writeInstructionsTab_();
}

function ensureTab_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function writeInstructionsTab_() {
  const sheet = ensureTab_('Instructions', ['Section', 'Notes']);
  const rows = [
    ['Inventory tab', 'Add/edit products here. Product ID, Created Date, Updated Date, Sync Version, Last Sync, and Firebase ID are system-controlled (shaded warning on edit) — everything else is yours to edit.'],
    ['Status column', 'Must be one of: active, inactive, archived — enforced by a dropdown.'],
    ['Color coding', 'Amber Current Stock = at or below Reorder Level. Red Expiry Date = already expired.'],
    ['Category / Brand / Sub Category / Unit / Supplier', 'Type a plain name — the sync engine matches or creates the matching record automatically. See the read-only mirror tabs for the current list of each.'],
    ['Categories / Brands / Subcategories / Units / Suppliers / Customers tabs', 'Read-only mirrors of the POS app\u2019s masters, refreshed each time "Mirror Masters to Sheet" is run from the Sync Center. Edit these in the POS app, not here.'],
    ['Syncing', 'Sync Now / Preview Changes live in the POS app\u2019s Sync Center, not in this spreadsheet.'],
    ['Sync Log tab', 'A running mirror of each sync run\u2019s summary, for anyone who only has access to the spreadsheet.']
  ];
  sheet.getRange(2, 1, rows.length, 2).setValues(rows);
  sheet.autoResizeColumns(1, 2);
}

function columnLetter_(colIndex) {
  let letter = '';
  let n = colIndex;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}
