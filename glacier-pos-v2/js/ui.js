// ============================================================
// Shared, dependency-free UI helpers used across every page.
// ============================================================

function fmtMoney(n) {
    const v = Number(n) || 0;
    return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function debounce(fn, delay = 250) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

// Toasts replace blocking alert()/confirm() popups for non-critical messages.
function toast(message, type = 'info', ms = 3500) {
    let stack = document.getElementById('toast-stack');
    if (!stack) {
        stack = document.createElement('div');
        stack.id = 'toast-stack';
        document.body.appendChild(stack);
    }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => el.remove(), ms);
}

function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
}
function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
}
// Click outside a modal's inner card closes it.
document.addEventListener('click', (e) => {
    if (e.target.classList && e.target.classList.contains('modal-backdrop')) {
        e.target.classList.remove('active');
    }
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-backdrop.active').forEach(m => m.classList.remove('active'));
    }
});

// Highlights the current page's nav link. Call once on DOMContentLoaded.
function highlightNav() {
    const here = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav-links a[data-page]').forEach(a => {
        a.classList.toggle('active', a.dataset.page === here);
    });
}

// Generates a simple, locally-unique EAN-like code for items with no barcode.
function generateLocalBarcode() {
    return '2' + Date.now().toString().slice(-9) + Math.floor(Math.random() * 10);
}

function todayStr() {
    return new Date().toISOString().split('T')[0];
}

document.addEventListener('DOMContentLoaded', highlightNav);
