// ============================================================
// Reuses your existing Glacier Firebase project.
// Firestore now stores EVERYTHING (products, vouchers, settings) —
// there is no Google Sheets / Apps Script dependency anymore.
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyDdwv7T9NNfLBg9_Mr6r_crbcK00xcyrGU",
  authDomain: "glacierpos-35f4c.firebaseapp.com",
  projectId: "glacierpos-35f4c",
  storageBucket: "glacierpos-35f4c.firebasestorage.app",
  messagingSenderId: "46444555909",
  appId: "1:46444555909:web:50430006771bd52eaf83ec"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
const auth = firebase.auth();

// Firestore offline persistence: lets the app keep working (read cached
// data) through brief network drops instead of hard-failing like the
// old Apps Script bridge did.
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
    console.warn("Offline persistence not enabled:", err.code);
});
