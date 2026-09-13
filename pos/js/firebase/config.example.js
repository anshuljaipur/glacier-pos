// Copy this file to config.local.js and fill in your Firebase project's
// *public* web config (from Firebase Console > Project Settings > Your apps).
//
// This is NOT a secret — Firebase web API keys are safe to ship to the
// browser because access is governed by Firestore Security Rules, not by
// hiding this key. What must NEVER go here or anywhere in this repo is a
// service-account JSON key or an Admin SDK credential — those live only in
// Cloud Functions' managed environment.
export const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT',
  storageBucket: 'YOUR_PROJECT.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID'
};

// Single-store today; every write stamps this so multi-store (section 66)
// never requires a data migration later.
export const STORE_ID = 'store-001';
