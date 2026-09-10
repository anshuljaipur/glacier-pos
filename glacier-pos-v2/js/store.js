// ============================================================
// Data layer. Every Firestore read/write in the app goes through
// here so the transaction/invoice-numbering logic only lives once.
// ============================================================

const DEFAULT_SETTINGS = {
    storeName: 'GLACIER',
    address: '',
    phone: '',
    gstin: '',
    invoicePrefix: 'GLC-',
    footer: 'Thank you for shopping with us!',
    lowStockDefault: 5
};

// ---------------- Settings ----------------
async function getSettings() {
    const snap = await db.collection('meta').doc('settings').get();
    return snap.exists ? { ...DEFAULT_SETTINGS, ...snap.data() } : DEFAULT_SETTINGS;
}
async function saveSettings(data) {
    return db.collection('meta').doc('settings').set(data, { merge: true });
}

// ---------------- Products ----------------
// Real-time listener — the product grid updates live on every device
// the moment stock changes, with no manual "Sync" button needed.
function listenProducts(onData, onError) {
    return db.collection('products').orderBy('itemname').onSnapshot(
        snap => onData(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
        err => { console.error('Product listener error:', err); if (onError) onError(err); }
    );
}
async function addProduct(data) {
    return db.collection('products').add({
        ...data,
        active: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
}
async function updateProduct(id, data) {
    return db.collection('products').doc(id).update({
        ...data,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
}
async function deleteProduct(id) {
    return db.collection('products').doc(id).delete();
}
async function findProductByBarcode(barcode) {
    const snap = await db.collection('products').where('barcode', '==', barcode).limit(1).get();
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}
async function isBarcodeTaken(barcode, excludeId = null) {
    const snap = await db.collection('products').where('barcode', '==', barcode).limit(2).get();
    if (snap.empty) return false;
    return snap.docs.some(d => d.id !== excludeId);
}

// ---------------- Vouchers (Sale / Purchase / Return) ----------------
// Atomically: (1) allocates a gapless sequential invoice number, and
// (2) adjusts every line item's stock — in ONE Firestore transaction,
// so two terminals billing at the same instant can never collide on
// an invoice number or race each other on stock quantity.
async function saveVoucherAndAdjustStock(payload) {
    const barcodes = [...new Set(payload.items.map(i => i.barcode).filter(Boolean))];
    const refMap = {};
    for (const bc of barcodes) {
        const snap = await db.collection('products').where('barcode', '==', bc).limit(1).get();
        if (!snap.empty) refMap[bc] = snap.docs[0].ref;
    }

    const settings = await getSettings();
    const counterField = payload.type === 'Sale' ? 'saleSeq' : payload.type === 'Purchase' ? 'purchaseSeq' : 'returnSeq';
    const prefix = payload.type === 'Sale' ? (settings.invoicePrefix || 'GLC-')
        : payload.type === 'Purchase' ? 'PUR-' : 'RET-';
    const counterRef = db.collection('meta').doc('counters');
    const voucherRef = db.collection('vouchers').doc();

    let invoiceNo;
    await db.runTransaction(async (tx) => {
        // ---- ALL reads must happen before any writes in a Firestore transaction ----
        const counterSnap = await tx.get(counterRef);
        const productSnaps = {};
        for (const bc in refMap) {
            productSnaps[bc] = await tx.get(refMap[bc]);
        }

        const seq = (counterSnap.exists ? (counterSnap.data()[counterField] || 0) : 0) + 1;
        invoiceNo = prefix + String(seq).padStart(5, '0');

        tx.set(counterRef, { [counterField]: seq }, { merge: true });

        payload.items.forEach(item => {
            const ref = refMap[item.barcode];
            const snap = ref ? productSnaps[item.barcode] : null;
            if (!ref || !snap || !snap.exists) return; // manual/unlisted line item — no stock to adjust
            const cur = parseFloat(snap.data().quantity) || 0;
            const delta = payload.type === 'Sale' ? -item.quantity : item.quantity; // Purchase & Return both add stock back
            tx.update(ref, { quantity: Math.max(0, cur + delta), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        });

        tx.set(voucherRef, {
            ...payload,
            invoiceNo,
            date: todayStr(),
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            voided: false,
            createdBy: (auth.currentUser && auth.currentUser.email) || 'unknown'
        });
    });

    return { id: voucherRef.id, invoiceNo };
}

// Soft-deletes a voucher (keeps it for audit trail, just excluded from
// totals) and reverses its stock effect — also inside one transaction.
async function voidVoucher(voucher) {
    const barcodes = [...new Set(voucher.items.map(i => i.barcode).filter(Boolean))];
    const refMap = {};
    for (const bc of barcodes) {
        const snap = await db.collection('products').where('barcode', '==', bc).limit(1).get();
        if (!snap.empty) refMap[bc] = snap.docs[0].ref;
    }
    const voucherRef = db.collection('vouchers').doc(voucher.id);

    await db.runTransaction(async (tx) => {
        const voucherSnap = await tx.get(voucherRef);
        const productSnaps = {};
        for (const bc in refMap) productSnaps[bc] = await tx.get(refMap[bc]);

        if (!voucherSnap.exists) throw new Error('Voucher no longer exists.');
        if (voucherSnap.data().voided) throw new Error('This voucher was already voided.');

        voucher.items.forEach(item => {
            const ref = refMap[item.barcode];
            const snap = ref ? productSnaps[item.barcode] : null;
            if (!ref || !snap || !snap.exists) return;
            const cur = parseFloat(snap.data().quantity) || 0;
            // Reverse of saveVoucherAndAdjustStock's delta:
            const delta = voucher.type === 'Sale' ? item.quantity : -item.quantity;
            tx.update(ref, { quantity: Math.max(0, cur + delta), updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
        });

        tx.update(voucherRef, {
            voided: true,
            voidedAt: firebase.firestore.FieldValue.serverTimestamp(),
            voidedBy: (auth.currentUser && auth.currentUser.email) || 'unknown'
        });
    });
}

// Capped at 500 most-recent vouchers for a snappy load; filters are
// applied client-side. Raise the limit in the README if you outgrow it.
async function getVouchers() {
    const snap = await db.collection('vouchers').orderBy('timestamp', 'desc').limit(500).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ---------------- Held bills (park a bill, resume from ANY terminal) ----------------
async function holdBill(data) {
    return db.collection('heldBills').add({ ...data, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
}
async function getHeldBills() {
    const snap = await db.collection('heldBills').orderBy('createdAt', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function deleteHeldBill(id) {
    return db.collection('heldBills').doc(id).delete();
}

// ---------------- Purchase Orders (supplier orders — don't touch stock) ----------------
async function addPurchaseOrder(data) {
    return db.collection('purchaseOrders').add({
        ...data, status: 'Pending', date: todayStr(),
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
}
function listenPurchaseOrders(onData) {
    return db.collection('purchaseOrders').orderBy('createdAt', 'desc').onSnapshot(
        snap => onData(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
}
async function updatePOStatus(id, status) {
    return db.collection('purchaseOrders').doc(id).update({ status });
}
async function deletePurchaseOrder(id) {
    return db.collection('purchaseOrders').doc(id).delete();
}
