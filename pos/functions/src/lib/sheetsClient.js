const { defineString, defineSecret } = require('firebase-functions/params');

// Configure via: firebase functions:secrets:set SYNC_SHARED_SECRET
// and firebase functions:config or a .env in functions/ for APPS_SCRIPT_URL
// (the deployed Apps Script Web App URL, ending in /exec).
const APPS_SCRIPT_URL = defineString('APPS_SCRIPT_URL');
const SYNC_SHARED_SECRET = defineSecret('SYNC_SHARED_SECRET');

async function callAppsScript(action, { method = 'GET', body = null } = {}) {
  const url = new URL(APPS_SCRIPT_URL.value());
  url.searchParams.set('action', action);
  url.searchParams.set('secret', SYNC_SHARED_SECRET.value());

  const res = await fetch(url.toString(), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });

  if (!res.ok) {
    throw new Error(`Apps Script request failed (${action}): ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  if (data && data.error) throw new Error(`Apps Script error (${action}): ${data.error}`);
  return data;
}

const getSheetSchema = () => callAppsScript('getSheetSchema');
const getInventoryWithHashes = () => callAppsScript('getInventoryWithHashes');

/**
 * rows: [{ productId, isNewRow, valuesByHeader: { 'Item Name': 'ABC', ... } }]
 * Each entry may set data columns and/or system columns (Firebase ID, Sync
 * Version, Last Sync) in one pass — see google-sheets/Code.gs applyWrites().
 */
const applySheetWrites = (rows) => callAppsScript('applyWrites', { method: 'POST', body: { rows } });

const writeSheetSyncLog = (entry) => callAppsScript('writeSyncLog', { method: 'POST', body: entry });

/** Phase 5: pushes a full rewrite of one read-only master mirror tab (Categories, Brands, etc.) — see Code.gs's MASTER_MIRROR_HEADERS comment for why these are one-way, not two-way like Inventory. */
const mirrorMasterTab = (tabName, headers, rows) => callAppsScript('mirrorMasterTab', { method: 'POST', body: { tabName, headers, rows } });

module.exports = {
  APPS_SCRIPT_URL, SYNC_SHARED_SECRET,
  getSheetSchema, getInventoryWithHashes, applySheetWrites, writeSheetSyncLog, mirrorMasterTab
};
