import {
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { auth, db } from '../firebase/init.js';

/**
 * Role/permission model (section 28). The Firebase Auth ID token carries a
 * `role` custom claim (set server-side by functions/src/setUserRole.js —
 * never client-writable). We read it here for UI decisions; Firestore
 * Security Rules are the actual enforcement boundary, not this file.
 */
export const ROLES = ['owner', 'manager', 'cashier', 'inventoryStaff', 'accountant', 'viewer'];

// What each role can do, used to show/hide UI. This mirrors, but does not
// replace, firestore.rules — server-side rules are the source of truth.
export const PERMISSIONS = {
  owner:          { view: true, add: true, edit: true, delete: true, approve: true, refund: true, stockAdjust: true, purchase: true, reports: true, settings: true, sync: true },
  manager:        { view: true, add: true, edit: true, delete: true, approve: true, refund: true, stockAdjust: true, purchase: true, reports: true, settings: true, sync: true },
  cashier:        { view: true, add: false, edit: false, delete: false, approve: false, refund: false, stockAdjust: false, purchase: false, reports: false, settings: false, sync: false },
  inventoryStaff: { view: true, add: true, edit: true, delete: false, approve: false, refund: false, stockAdjust: true, purchase: true, reports: false, settings: false, sync: true },
  accountant:     { view: true, add: false, edit: false, delete: false, approve: false, refund: false, stockAdjust: false, purchase: false, reports: true, settings: false, sync: false },
  viewer:         { view: true, add: false, edit: false, delete: false, approve: false, refund: false, stockAdjust: false, purchase: false, reports: true, settings: false, sync: false }
};

let currentUser = null;
let currentRole = null;
let currentProfile = null;
const listeners = new Set();

function notify() {
  for (const fn of listeners) fn({ user: currentUser, role: currentRole, profile: currentProfile });
}

/** Subscribe to auth state; returns an unsubscribe function. */
export function onAuthChange(fn) {
  listeners.add(fn);
  fn({ user: currentUser, role: currentRole, profile: currentProfile });
  return () => listeners.delete(fn);
}

export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function signOut() {
  await fbSignOut(auth);
}

export function can(action) {
  if (!currentRole) return false;
  return !!(PERMISSIONS[currentRole] && PERMISSIONS[currentRole][action]);
}

export function requireAuth({ redirectTo = 'index.html' } = {}) {
  return new Promise((resolve) => {
    const unsub = onAuthChange(({ user, role }) => {
      if (user === null) return; // still resolving initial state
      if (!user) {
        window.location.href = redirectTo;
        return;
      }
      unsub();
      resolve({ user, role });
    });
  });
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user || false;
  if (!user) {
    currentRole = null;
    currentProfile = null;
    notify();
    return;
  }
  const idTokenResult = await user.getIdTokenResult();
  currentRole = idTokenResult.claims.role || null;

  // users/{uid} document holds display info (name, etc.) — not the
  // authorization decision, which lives in the custom claim above.
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    currentProfile = snap.exists() ? snap.data() : null;
  } catch {
    currentProfile = null;
  }
  notify();
});
