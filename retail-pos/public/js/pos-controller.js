import { SalesEngine } from './sales/SalesEngine.js';

// Firebase bootstrap using environment configuration
const firebaseConfig = window.__FIREBASE_CONFIG__;
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Enable offline persistence for uninterrupted billing
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
  console.warn("Firestore offline persistence failed to initialize:", err.code);
});

const salesEngine = new SalesEngine(db, { uid: 'usr_cashier1', name: 'Cashier 1' });

let cart = [];
let barcodeBuffer = '';
let lastKeyTime = Date.now();

const barcodeInput = document.getElementById('barcodeInput');
const searchResultsContainer = document.getElementById('searchResultsContainer');
const cartTableBody = document.getElementById('cartTableBody');

// Hardware Barcode Scanner Listener (catches rapid input ending in Enter)
window.addEventListener('keydown', (e) => {
  const currentTime = Date.now();
  if (currentTime - lastKeyTime > 100) {
    barcodeBuffer = '';
  }
  lastKeyTime = currentTime;

  if (e.key === 'Enter') {
    if (barcodeBuffer.length >= 4) {
      lookupAndAddProduct(barcodeBuffer.trim());
      barcodeBuffer = '';
      if (document.activeElement === barcodeInput) barcodeInput.value = '';
    }
  } else if (e.key.length === 1) {
    barcodeBuffer += e.key;
  }
});

// Search input debouncer
barcodeInput.addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  if (q.length >= 2) performCatalogSearch(q);
  else searchResultsContainer.innerHTML = '';
});

async function lookupAndAddProduct(barcode) {
  const snap = await db.collection('products')
    .where('barcode', '==', barcode)
    .where('status', '==', 'active')
    .limit(1)
    .get();

  if (snap.empty) {
    alert(`Barcode ${barcode} not found in inventory.`);
    return;
  }

  const prod = { id: snap.docs[0].id, ...snap.docs[0].data() };
  addToCart(prod);
}

async function performCatalogSearch(query) {
  // Query by prefix on itemName
  const snap = await db.collection('products')
    .where('itemName', '>=', query)
    .where('itemName', '<=', query + '\uf8ff')
    .limit(12)
    .get();

  searchResultsContainer.innerHTML = '';
  snap.docs.forEach(doc => {
    const p = { id: doc.id, ...doc.data() };
    const card = document.createElement('div');
    card.className = 'product-card';
    card.innerHTML = `
      <img src="${p.imageUrl || 'assets/placeholder.png'}" onerror="this.src='assets/placeholder.png'" alt="${p.itemName}">
      <div class="name">${p.itemName}</div>
      <div class="pricing">
        <span>₹${p.sellingPrice.toFixed(2)}</span>
        <span style="color:${p.currentStock > 0 ? '#2e7d32' : '#d32f2f'}">${p.currentStock} in stock</span>
      </div>
    `;
    card.onclick = () => addToCart(p);
    searchResultsContainer.appendChild(card);
  });
}

function addToCart(product) {
  const existing = cart.find(item => item.productId === product.id);
  if (existing) {
    if (existing.qty + 1 > product.currentStock) {
      alert(`Cannot add more. Only ${product.currentStock} units available.`);
      return;
    }
    existing.qty += 1;
  } else {
    if (product.currentStock < 1) {
      alert(`Product ${product.itemName} is currently OUT OF STOCK.`);
      return;
    }
    cart.push({
      productId: product.id,
      itemName: product.itemName,
      rate: product.sellingPrice,
      mrp: product.mrp,
      gstRate: product.gstRate,
      qty: 1,
      stockLimit: product.currentStock
    });
  }
  renderCart();
}

function renderCart() {
  cartTableBody.innerHTML = '';
  let subtotal = 0;
  let gstTotal = 0;

  cart.forEach((item, index) => {
    const lineTotal = item.rate * item.qty;
    const taxable = lineTotal / (1 + (item.gstRate / 100));
    const gst = lineTotal - taxable;

    subtotal += taxable;
    gstTotal += gst;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.itemName}</td>
      <td>₹${item.rate.toFixed(2)}</td>
      <td>
        <input type="number" min="1" max="${item.stockLimit}" value="${item.qty}" style="width:50px;" data-index="${index}" class="qty-field" />
      </td>
      <td>₹${gst.toFixed(2)}</td>
      <td>₹${lineTotal.toFixed(2)}</td>
      <td><button onclick="removeItem(${index})" style="border:none;background:none;cursor:pointer;color:red;">&times;</button></td>
    `;
    cartTableBody.appendChild(tr);
  });

  document.querySelectorAll('.qty-field').forEach(input => {
    input.addEventListener('change', (e) => {
      const idx = Number(e.target.dataset.index);
      const val = Number(e.target.value);
      if (val > 0 && val <= cart[idx].stockLimit) {
        cart[idx].qty = val;
        renderCart();
      } else {
        alert("Invalid quantity requested");
        e.target.value = cart[idx].qty;
      }
    });
  });

  window.removeItem = (idx) => {
    cart.splice(idx, 1);
    renderCart();
  };

  document.getElementById('summaryTaxable').textContent = `₹${subtotal.toFixed(2)}`;
  document.getElementById('summaryGst').textContent = `₹${gstTotal.toFixed(2)}`;
  document.getElementById('summaryGrandTotal').textContent = `₹${(subtotal + gstTotal).toFixed(2)}`;
}

// Payment trigger handling
document.querySelectorAll('.btn-pay').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (cart.length === 0) {
      alert("Cart is empty");
      return;
    }

    const mode = btn.dataset.mode;
    const grandTotal = parseFloat(document.getElementById('summaryGrandTotal').textContent.replace('₹', ''));

    const salePayload = {
      items: cart,
      customerId: 'WALK-IN',
      paymentDetails: [{ mode, amount: grandTotal }]
    };

    try {
      btn.disabled = true;
      const invoice = await salesEngine.processSale(salePayload);
      alert(`Sale Complete! Invoice #${invoice.invoiceNumber}`);
      cart = [];
      renderCart();
      if (barcodeInput) barcodeInput.focus();
    } catch (err) {
      alert(`Checkout Failed: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  });
});
