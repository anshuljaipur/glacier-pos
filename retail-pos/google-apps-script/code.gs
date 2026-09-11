/**
 * Apps Script Relay for POS Google Sheets Sync Engine
 */

const CONFIG = {
  FIREBASE_FUNCTION_URL: "https://asia-south1-your-project-id.cloudfunctions.net",
  AUTH_SECRET_KEY: "xU5wwKAfJZYChCP6keq0", // Keep in Script Properties in production
  SHEET_NAME_INVENTORY: "Inventory",
  SHEET_NAME_LOGS: "Sync Log",
  SHEET_NAME_STATUS: "Sync Status"
};

/**
 * Serves inbound Webhook calls from POS/Firebase to read/update the Sheet
 */
function doPost(e) {
  const lock = LockService.getDocumentLock();
  try {
    lock.waitLock(30000); // Wait up to 30s for concurrent sync resolution
    const authHeader = e.parameter.authKey || (e.postData && JSON.parse(e.postData.contents).authKey);
    if (authHeader !== CONFIG.AUTH_SECRET_KEY) {
      return responseJSON({ success: false, error: "Unauthorized access" }, 401);
    }

    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;

    if (action === "GET_SHEET_DATA") {
      return responseJSON(getSheetData());
    } else if (action === "APPLY_FIREBASE_CHANGES") {
      return responseJSON(applyFirebaseChanges(payload.changes));
    }

    return responseJSON({ success: false, error: "Unknown action" }, 400);
  } catch (err) {
    return responseJSON({ success: false, error: err.message }, 500);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Reads headers dynamically and extracts all rows with computed content hash
 */
function getSheetData() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME_INVENTORY);
  const data = sheet.getDataRange().getValues();
  if (data.length < 1) return { success: false, error: "Inventory sheet empty" };

  const headers = data[0].map(h => String(h).trim());
  const rows = [];

  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const rowObj = { _sheetRowNumber: r + 1 };
    let hasData = false;

    headers.forEach((header, index) => {
      rowObj[header] = row[index];
      if (row[index] !== "" && row[index] !== null) hasData = true;
    });

    if (hasData) {
      // Compute deterministic content hash for master fields excluding operational row metadata
      const hashPayload = headers
        .filter(h => !["Updated Date", "Created Date", "Sync Version", "Last Sync"].includes(h))
        .map(h => `${h}:${rowObj[h]}`)
        .join("|");
      rowObj._contentHash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, hashPayload));
      rows.push(rowObj);
    }
  }

  return { success: true, headers, rows };
}

/**
 * Updates or inserts rows coming from Firebase into Google Sheets
 */
function applyFirebaseChanges(changes) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME_INVENTORY);
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());
  const prodIdCol = headers.indexOf("Product ID");

  if (prodIdCol === -1) {
    throw new Error("Missing 'Product ID' header in Google Sheet");
  }

  const rowMap = new Map();
  for (let i = 1; i < data.length; i++) {
    const pid = String(data[i][prodIdCol]).trim();
    if (pid) rowMap.set(pid, i + 1);
  }

  let updatedCount = 0;
  let addedCount = 0;

  changes.forEach(change => {
    const pid = change.productId;
    const values = change.data;

    if (rowMap.has(pid)) {
      // Update existing row
      const rowIndex = rowMap.get(pid);
      headers.forEach((header, colIndex) => {
        if (values.hasOwnProperty(header)) {
          sheet.getRange(rowIndex, colIndex + 1).setValue(values[header]);
        }
      });
      updatedCount++;
    } else {
      // Append new row
      const newRow = new Array(headers.length).fill("");
      headers.forEach((header, colIndex) => {
        if (values.hasOwnProperty(header)) {
          newRow[colIndex] = values[header];
        }
      });
      sheet.appendRow(newRow);
      addedCount++;
    }
  });

  return { success: true, updatedCount, addedCount };
}

function responseJSON(data, status = 200) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
