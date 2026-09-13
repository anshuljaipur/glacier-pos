const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { mirrorMasterTab, SYNC_SHARED_SECRET } = require('./lib/sheetsClient');

if (!admin.apps.length) admin.initializeApp();

const SYNC_ROLES = ['owner', 'manager', 'inventoryStaff'];

function toDateStr(ts) {
  try { return ts?.toDate ? ts.toDate().toISOString().slice(0, 10) : ''; } catch { return ''; }
}

async function fetchSimpleMaster(db, collectionName) {
  const snap = await db.collection(collectionName).get();
  return snap.docs.map((d) => {
    const data = d.data();
    return { Name: data.name || '', Active: data.active ? 'Yes' : 'No', 'Created Date': toDateStr(data.createdAt) };
  });
}

async function fetchSubCategories(db) {
  const [snap, catSnap] = await Promise.all([db.collection('subCategories').get(), db.collection('categories').get()]);
  const categoryNames = new Map(catSnap.docs.map((d) => [d.id, d.data().name || '']));
  return snap.docs.map((d) => {
    const data = d.data();
    return { Name: data.name || '', 'Parent Category': categoryNames.get(data.parentId) || '', Active: data.active ? 'Yes' : 'No', 'Created Date': toDateStr(data.createdAt) };
  });
}

async function fetchSuppliers(db) {
  const snap = await db.collection('suppliers').get();
  return snap.docs.map((d) => {
    const s = d.data();
    return { 'Supplier ID': d.id, Name: s.name || '', Mobile: s.mobile || '', Email: s.email || '', Address: s.address || '', GSTIN: s.gstin || '', 'Payment Terms': s.paymentTerms || '', Status: s.status || '' };
  });
}

async function fetchCustomers(db) {
  const snap = await db.collection('customers').get();
  return snap.docs.map((d) => {
    const c = d.data();
    return { 'Customer ID': d.id, Name: c.name || '', Mobile: c.mobile || '', Email: c.email || '', Address: c.address || '', GSTIN: c.gstin || '', 'Credit Limit': c.creditLimit || '', Status: c.status || '' };
  });
}

exports.mirrorMastersToSheet = onCall({ secrets: [SYNC_SHARED_SECRET] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  if (!SYNC_ROLES.includes(request.auth.token.role)) throw new HttpsError('permission-denied', 'Your role does not have sync permission.');

  const db = admin.firestore();
  const jobs = [
    { tab: 'Categories', rows: await fetchSimpleMaster(db, 'categories') },
    { tab: 'Brands', rows: await fetchSimpleMaster(db, 'brands') },
    { tab: 'Units', rows: await fetchSimpleMaster(db, 'units') },
    { tab: 'Subcategories', rows: await fetchSubCategories(db) },
    { tab: 'Suppliers', rows: await fetchSuppliers(db) },
    { tab: 'Customers', rows: await fetchCustomers(db) }
  ];

  const results = [];
  for (const job of jobs) {
    try {
      const res = await mirrorMasterTab(job.tab, null, job.rows);
      results.push({ tab: job.tab, rowCount: res.rowCount });
    } catch (err) {
      results.push({ tab: job.tab, error: err.message });
    }
  }
  return { results };
});
