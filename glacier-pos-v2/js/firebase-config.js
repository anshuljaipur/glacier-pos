// ============================================================
// Reuses your existing Glacier Firebase project.
// Firestore now stores EVERYTHING (products, vouchers, settings) —
// there is no Google Sheets / Apps Script dependency anymore.
// ============================================================
const firebaseConfig = {
    apiKey: "AIzaSyCZJj830ufepvh2fh_ehkPoOki_l3QcCew",
    authDomain: "glacier-ice-cream-parlor.firebaseapp.com",
    projectId: "glacier-ice-cream-parlor",
    storageBucket: "glacier-ice-cream-parlor.firebasestorage.app",
    messagingSenderId: "281867852305",
    appId: "1:281867852305:web:6a35075905bdadb0592fb0"
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
