// ============================================================
// Simple session gate. Every page except login.html includes this
// file; it redirects to login.html if nobody is signed in.
// Remember: this JS-side check is a UX convenience only — the real
// security boundary is your Firestore Security Rules (see README).
// ============================================================
const IS_LOGIN_PAGE = location.pathname.endsWith('login.html');

function doLogin(email, password) {
    return auth.signInWithEmailAndPassword(email.trim(), password);
}

function doLogout() {
    auth.signOut().then(() => { location.href = 'login.html'; });
}

auth.onAuthStateChanged(user => {
    if (!user && !IS_LOGIN_PAGE) {
        location.href = 'login.html';
        return;
    }
    if (user && IS_LOGIN_PAGE) {
        location.href = 'index.html';
        return;
    }
    if (user) {
        const el = document.getElementById('current-user');
        if (el) el.textContent = user.email;
        const logoutBtn = document.getElementById('btn-logout');
        if (logoutBtn) logoutBtn.addEventListener('click', doLogout);
    }
});
