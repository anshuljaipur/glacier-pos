import {
  collection, getDocs, query, where, orderBy, limit, startAfter
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase/init.js';

const PAGE_SIZE = 50;

/**
 * Filters are applied client-side after an ordered, capped fetch rather
 * than as compound Firestore queries — audit volume for a single-counter
 * store is modest, and this avoids needing a new composite index for every
 * filter combination an admin might want. Revisit if/when Phase 9's
 * performance pass finds this doesn't hold at scale.
 */
export async function listAuditLogs({ module = '', action = '', userId = '', cursor = null, pageSize = PAGE_SIZE } = {}) {
  let q = query(collection(db, 'auditLogs'), orderBy('dateTime', 'desc'), limit(pageSize));
  if (cursor) q = query(collection(db, 'auditLogs'), orderBy('dateTime', 'desc'), startAfter(cursor), limit(pageSize));
  const snap = await getDocs(q);
  let rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (module) rows = rows.filter((r) => r.module === module);
  if (action) rows = rows.filter((r) => r.action.toLowerCase().includes(action.toLowerCase()));
  if (userId) rows = rows.filter((r) => r.userId === userId);
  return { rows, nextCursor: snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1] : null };
}

/** Resolved conflicts, for the Conflict History panel — see js/sync/syncService for the currently-open ones. */
export async function listResolvedConflicts({ max = 50 } = {}) {
  const q = query(collection(db, 'syncConflicts'), where('status', '==', 'resolved'), orderBy('resolvedAt', 'desc'), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
