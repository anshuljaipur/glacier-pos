// Central Firebase bootstrap. Every module imports { db, auth, STORE_ID }
// from here rather than initializing its own app instance.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore,
  enableIndexedDbPersistence,
  connectFirestoreEmulator
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  getAuth,
  connectAuthEmulator
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFunctions,
  connectFunctionsEmulator
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';

// config.local.js is gitignored; config.example.js documents the shape.
// Fall back to the example so the app still loads (with a console warning)
// before a developer has created their local config.
let firebaseConfig, STORE_ID;
try {
  ({ firebaseConfig, STORE_ID } = await import('./config.local.js'));
} catch {
  console.warn(
    '[firebase/init] config.local.js not found — copy js/firebase/config.example.js ' +
    'to js/firebase/config.local.js and fill in your project values.'
  );
  ({ firebaseConfig, STORE_ID } = await import('./config.example.js'));
}

export { STORE_ID };

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const functions = getFunctions(app);

// Section 30: offline resilience. Multi-tab is intentionally not enabled
// here (single-tab persistence keeps the "which tab owns the write queue"
// question simple for a single-till POS); revisit if multi-counter support
// (section 66) needs multiple simultaneous tabs on one till.
let persistenceReady = enableIndexedDbPersistence(db).then(
  () => true,
  (err) => {
    if (err.code === 'failed-precondition') {
      console.warn('[firebase/init] Offline persistence unavailable: multiple tabs open.');
    } else if (err.code === 'unimplemented') {
      console.warn('[firebase/init] Offline persistence unavailable in this browser.');
    }
    return false;
  }
);
export const offlinePersistenceReady = persistenceReady;

// Optional local emulator support for development without touching a real
// project: set window.__USE_FIREBASE_EMULATORS__ = true before this module
// loads (e.g. in a <script> tag) to route to the local emulator suite.
if (typeof window !== 'undefined' && window.__USE_FIREBASE_EMULATORS__) {
  connectFirestoreEmulator(db, 'localhost', 8080);
  connectAuthEmulator(auth, 'http://localhost:9099');
  connectFunctionsEmulator(functions, 'localhost', 5001);
  console.info('[firebase/init] Connected to local emulators.');
}

/**
 * Live connectivity state for the ONLINE / OFFLINE / SYNCING banner
 * (section 30 / 74). Firestore's own online/offline is exposed indirectly
 * via snapshot metadata, so the app-level UI listens to the browser's
 * network events plus pending-write counts rather than a Firestore API
 * that doesn't exist for this directly.
 */
export const connectivity = {
  online: navigator.onLine,
  listeners: new Set(),
  _notify() {
    for (const fn of this.listeners) fn(this.online);
  },
  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.online);
    return () => this.listeners.delete(fn);
  }
};
window.addEventListener('online', () => { connectivity.online = true; connectivity._notify(); });
window.addEventListener('offline', () => { connectivity.online = false; connectivity._notify(); });
