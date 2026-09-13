const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();

const VALID_ROLES = ['owner', 'manager', 'cashier', 'inventoryStaff', 'accountant', 'viewer'];

/**
 * Callable function: setUserRole({ targetUid, role })
 * Only callers whose own token already carries role 'owner' may call this —
 * enforced here, not just in Firestore rules, because custom claims are set
 * exclusively through the Admin SDK and can never be granted by a client
 * write (section 28 permission model, section 48 security).
 */
exports.setUserRole = onCall(async (request) => {
  const callerRole = request.auth?.token?.role;
  if (callerRole !== 'owner') {
    throw new HttpsError('permission-denied', 'Only an owner can assign roles.');
  }

  const { targetUid, role } = request.data || {};
  if (!targetUid || !VALID_ROLES.includes(role)) {
    throw new HttpsError('invalid-argument', `role must be one of: ${VALID_ROLES.join(', ')}`);
  }

  await admin.auth().setCustomUserClaims(targetUid, { role });
  await admin.firestore().collection('auditLogs').add({
    dateTime: admin.firestore.FieldValue.serverTimestamp(),
    userId: request.auth.uid,
    action: 'ROLE_ASSIGNED',
    module: 'users',
    recordId: targetUid,
    field: 'role',
    newValue: role,
    source: 'POS'
  });

  return { ok: true };
});
