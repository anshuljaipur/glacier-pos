const crypto = require('crypto');

/** Mirrors js/utils/hash.js exactly: sort keys, JSON.stringify, SHA-256 hex. */
function hashSyncedFields(obj) {
  const sorted = Object.keys(obj).sort().reduce((acc, k) => {
    acc[k] = obj[k];
    return acc;
  }, {});
  const json = JSON.stringify(sorted);
  return crypto.createHash('sha256').update(json).digest('hex');
}

module.exports = { hashSyncedFields };
