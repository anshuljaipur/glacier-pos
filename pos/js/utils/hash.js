/**
 * Deterministic content hash of a plain object's synced fields, used to
 * detect real changes without a full field-by-field diff across thousands
 * of rows. Keys are sorted so field order never affects the hash.
 */
export async function hashSyncedFields(obj) {
  const sorted = Object.keys(obj).sort().reduce((acc, k) => {
    acc[k] = obj[k];
    return acc;
  }, {});
  const json = JSON.stringify(sorted);
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
