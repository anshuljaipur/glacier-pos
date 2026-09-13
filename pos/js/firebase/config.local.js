// Copy this file to config.local.js and fill in your Firebase project's
// *public* web config (from Firebase Console > Project Settings > Your apps).
//
// This is NOT a secret — Firebase web API keys are safe to ship to the
// browser because access is governed by Firestore Security Rules, not by
// hiding this key. What must NEVER go here or anywhere in this repo is a
// service-account JSON key or an Admin SDK credential — those live only in
// Cloud Functions' managed environment.
export const firebaseConfig = {
  apiKey: "AIzaSyDdwv7T9NNfLBg9_Mr6r_crbcK00xcyrGU",
  authDomain: "glacierpos-35f4c.firebaseapp.com",
  projectId: "glacierpos-35f4c",
  storageBucket: "glacierpos-35f4c.firebasestorage.app",
  messagingSenderId: "46444555909",
  appId: "1:46444555909:web:50430006771bd52eaf83ec"
};
// Single-store today; every write stamps this so multi-store (section 66)
// never requires a data migration later.
export const STORE_ID = 'store-001';
