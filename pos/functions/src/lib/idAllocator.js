const admin = require('firebase-admin');

/** Mirrors js/utils/idGenerator.js's allocateId, using the Admin SDK. */
async function allocateId(db, name, prefix, padLength = 6) {
  const counterRef = db.collection('counters').doc(name);
  const next = await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists ? (snap.data().next || 0) : 0;
    const value = current + 1;
    tx.set(counterRef, { next: value }, { merge: true });
    return value;
  });
  return `${prefix}-${String(next).padStart(padLength, '0')}`;
}

const allocateProductId = (db) => allocateId(db, 'products', 'PROD');

module.exports = { allocateId, allocateProductId };
