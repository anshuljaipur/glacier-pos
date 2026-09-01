let scanBuffer = "";
let scanTimeout;

document.addEventListener('keydown', (e) => {
    if(e.key === 'F4') { e.preventDefault(); CartApp.openPaymentPopup(); return; }
    if(e.key === 'Escape') { 
        document.getElementById('paymentModal').classList.remove('active');
        if(document.getElementById('printWrapper').classList.contains('active')) {
            CartApp.closePrintAndReset();
        }
        return; 
    }
    
    // Barcode emulation
    if(e.target.tagName === 'INPUT' && e.target.id !== 'posSearch') return;
    if(e.key.length === 1) {
        scanBuffer += e.key;
        clearTimeout(scanTimeout);
        scanTimeout = setTimeout(() => {
            if(scanBuffer.length >= 3) {
                const prod = InventoryApp.products.find(p => p.barcode && p.barcode.toString().trim() === scanBuffer.trim());
                if(prod) {
                    CartApp.addItem(prod);
                    document.getElementById('posSearch').value = '';
                }
            }
            scanBuffer = "";
        }, 50);
    }
});

const InventoryApp = {
    products: [],
    async sync() {
        try {
            const btn = document.getElementById('network-status');
            btn.textContent = "↻ Syncing...";
            this.products = await API.getInventory();
            btn.textContent = "↻ Sync Data";
            this.populateFilters();
            this.renderGrid(this.products);
        } catch (err) {
            document.getElementById('network-status').textContent = "⚠ Offline Mode";
        }
    },
    populateFilters() {
        const cats = [...new Set(this.products.map(p => p.category))].filter(Boolean);
        const brands = [...new Set(this.products.map(p => p.brandname))].filter(Boolean);
        const catSelect = document.getElementById('filterCategory');
        const brandSelect = document.getElementById('filterBrand');
        catSelect.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option value="${c}">${c}</option>`).join('');
        brandSelect.innerHTML = '<option value="">All Brands</option>' + brands.map(b => `<option value="${b}">${b}</option>`).join('');
    },
    clearFilters() {
        document.getElementById('posSearch').value = '';
        document.getElementById('filterCategory').value = '';
        document.getElementById('filterBrand').value = '';
        this.filterItems();
    },
    filterItems() {
        const query = document.getElementById('posSearch').value.toLowerCase();
        const cat = document.getElementById('filterCategory').value;
        const brand = document.getElementById('filterBrand').value;
        
        const filtered = this.products.filter(p => {
            const matchSearch = p.itemname.toLowerCase().includes(query) || (p.barcode && p.barcode.toString().toLowerCase().includes(query));
            const matchCat = cat === '' || p.category === cat;
            const matchBrand = brand === '' || p.brandname === brand;
            return matchSearch && matchCat && matchBrand;
        });
        this.renderGrid(filtered);
    },
    renderGrid(data) {
        const grid = document.getElementById('itemGrid');
        grid.innerHTML = '';
        data.forEach(p => {
            const stock = parseFloat(p.quantity) || 0;
            const rate = parseFloat(p.sellingrate) || 0;
            const safeName = p.itemname.replace(/"/g, '&quot;');
            
            let badgeClass = stock <= 0 ? 'stock-badge low' : 'stock-badge';
            
            const card = document.createElement('button');
            card.className = 'item-card';
            card.type = 'button';
            card.onclick = () => CartApp.addItem(p);
            
            card.innerHTML = `
                <div class="${badgeClass}">${stock}</div>
                <div class="item-img">
                    <img src="${API.resolveImage(p.image)}" class="item-img-tag" loading="lazy" onerror="this.src='${API.resolveImage('')}'">
                </div>
                <div class="item-details">
                    <div class="item-name">${p.itemname}</div>
                    <div class="item-price">₹${rate.toFixed(2)}</div>
                </div>
            `;
            grid.appendChild(card);
        });
    }
};

const CartApp = {
    items: [],
    addItem(product) {
        const existing = this.items.find(i => i.barcode === product.barcode);
        if (existing) {
            existing.qty += 1;
        } else {
            this.items.push({
                barcode: product.barcode,
                itemName: product.itemname,
                qty: 1,
                rate: parseFloat(product.sellingrate),
                discountPerc: 0
            });
        }
        this.render();
    },
    updateField(barcode, field, val) {
        const item = this.items.find(i => i.barcode === barcode);
        if(item) {
            item[field] = field === 'qty' ? (parseInt(val, 10) || 1) : (parseFloat(val) || 0);
            this.render();
        }
    },
    removeItem(barcode) {
        this.items = this.items.filter(i => i.barcode !== barcode);
        this.render();
    },
    render() {
        const tbody = document.getElementById('cartBody');
        tbody.innerHTML = '';
        let subtotal = 0;
        let totalItems = 0;

        this.items.forEach(c => {
            const gross = c.qty * c.rate;
            const disAmt = gross * (c.discountPerc / 100);
            const net = gross - disAmt;
            subtotal += net;
            totalItems += c.qty;

            tbody.innerHTML += `
                <li class="cart-item">
                    <div style="flex: 2; font-weight:600; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;" title="${c.itemName}">${c.itemName}</div>
                    <div style="flex: 0.8;"><input type="number" class="cart-item-input" value="${c.qty}" onchange="CartApp.updateField('${c.barcode}', 'qty', this.value)" min="1"></div>
                    <div style="flex: 1;"><input type="number" class="cart-item-input" value="${c.rate}" onchange="CartApp.updateField('${c.barcode}', 'rate', this.value)" min="0" step="0.01"></div>
                    <div style="flex: 0.8;"><input type="number" class="cart-item-input" value="${c.discountPerc}" onchange="CartApp.updateField('${c.barcode}', 'discountPerc', this.value)" min="0" max="100" step="0.01"></div>
                    <div style="flex: 1; font-weight:bold; text-align:right;">₹${net.toFixed(2)}</div>
                    <div style="width: 25px; text-align:right;"><button class="btn-del" onclick="CartApp.removeItem('${c.barcode}')">×</button></div>
                </li>
            `;
        });

        const bType = document.getElementById('billDiscountType').value;
        const bVal = parseFloat(document.getElementById('billDiscountValue').value) || 0;
        let billDisAmt = bType === 'Amt' ? bVal : subtotal * (bVal / 100);
        
        const netBeforeRound = subtotal - billDisAmt;
        const finalPayable = Math.round(netBeforeRound);
        const roundOff = finalPayable - netBeforeRound;

        document.getElementById('cartQtySummary').innerText = `${totalItems} Qty (${this.items.length} Types)`;
        document.getElementById('cartSubtotal').innerText = `₹${subtotal.toFixed(2)}`;
        
        document.getElementById('cartRoundOff').innerText = `${roundOff > 0 ? '+' : ''}${roundOff.toFixed(2)}`;
        document.getElementById('cartGrandTotal').innerText = `₹${Math.max(0, finalPayable).toFixed(2)}`;
        
        if(document.getElementById('paymentModal').classList.contains('active')) this.calcSplitPay();
    },
    openPaymentPopup() {
        if(this.items.length === 0) return alert("Cart is empty!");
        const grandTotal = parseFloat(document.getElementById('cartGrandTotal').innerText.replace('₹','')) || 0;
        document.getElementById('payModalTotal').innerText = `₹${grandTotal.toFixed(2)}`;
        document.getElementById('payCash').value = '';
        document.getElementById('payUPI').value = '';
        document.getElementById('payCard').value = '';
        this.calcSplitPay();
        document.getElementById('paymentModal').classList.add('active');
        setTimeout(() => document.getElementById('payCash').focus(), 50);
    },
    closePaymentPopup() {
        document.getElementById('paymentModal').classList.remove('active');
    },
    calcSplitPay() {
        const grandTotal = parseFloat(document.getElementById('cartGrandTotal').innerText.replace('₹','')) || 0;
        const cash = parseFloat(document.getElementById('payCash').value) || 0;
        const upi = parseFloat(document.getElementById('payUPI').value) || 0;
        const card = parseFloat(document.getElementById('payCard').value) || 0;
        
        const balance = grandTotal - (cash + upi + card);
        const lbl = document.getElementById('lblBalance');
        const box = document.getElementById('payBalance');
        
        if (balance > 0) { lbl.innerText = "Due"; lbl.style.color = "var(--danger)"; box.style.color = "var(--danger)"; box.value = balance.toFixed(2); } 
        else if (balance < 0) { lbl.innerText = "Change"; lbl.style.color = "var(--success)"; box.style.color = "var(--success)"; box.value = Math.abs(balance).toFixed(2); } 
        else { lbl.innerText = "Settled"; lbl.style.color = "var(--text-main)"; box.style.color = "var(--text-main)"; box.value = "0.00"; }
    },
    async checkout() {
        const btn = document.getElementById('btn-save-sale');
        btn.textContent = 'Processing...';
        btn.disabled = true;

        const cash = parseFloat(document.getElementById('payCash').value) || 0;
        const upi = parseFloat(document.getElementById('payUPI').value) || 0;
        const card = parseFloat(document.getElementById('payCard').value) || 0;
        let modes = [];
        if(cash > 0) modes.push('Cash');
        if(upi > 0) modes.push('UPI');
        if(card > 0) modes.push('Card');
        
        const payload = {
            invoiceNo: CONFIG.INVOICE_PREFIX + Date.now().toString().slice(-6),
            customer: document.getElementById('posCustomer').value || 'Walk-in',
            paymentMode: modes.length > 1 ? 'Split' : (modes[0] || 'Cash'),
            items: this.items.map(i => ({
                barcode: i.barcode,
                itemName: i.itemName,
                quantity: i.qty,
                rate: i.rate,
                discount: (i.qty * i.rate) * (i.discountPerc / 100),
                amount: (i.rate * i.qty) - ((i.qty * i.rate) * (i.discountPerc / 100))
            }))
        };

        try {
            await API.saveSale(payload);
            this.triggerPrint(payload);
        } catch (error) {
            alert('Checkout failed: ' + error.message);
        } finally {
            btn.textContent = 'SAVE & PRINT';
            btn.disabled = false;
        }
    },
    triggerPrint(payload) {
        document.getElementById('paymentModal').classList.remove('active');
        document.getElementById('prAddress').innerText = CONFIG.STORE_ADDRESS;
        document.getElementById('prContact').innerText = `Ph: ${CONFIG.STORE_PHONE}`;
        document.getElementById('prCustomer').innerText = payload.customer;
        document.getElementById('prCustMob').innerText = document.getElementById('posMobile').value || '-';
        document.getElementById('prDate').innerText = new Date().toLocaleString();
        document.getElementById('prInv').innerText = payload.invoiceNo;
        
        const tbody = document.getElementById('prItemsBody');
        tbody.innerHTML = '';
        
        let totalAmt = 0;
        payload.items.forEach(item => {
            totalAmt += item.amount;
            let itemNameHtml = `<b>${item.itemName}</b>`;
            if(item.discount > 0) itemNameHtml += `<br><span style="font-size: 0.85em; font-style: italic;">(Disc applied)</span>`;
            
            tbody.innerHTML += `
                <tr>
                    <td style="padding-bottom: 5px;">${itemNameHtml}</td>
                    <td style="text-align:center; vertical-align:top;">${item.quantity}</td>
                    <td style="text-align:right; vertical-align:top;">${item.rate.toFixed(2)}</td>
                    <td style="text-align:right; vertical-align:top;">${item.amount.toFixed(2)}</td>
                </tr>
            `;
        });
        
        document.getElementById('prTotal').innerText = totalAmt.toFixed(2);
        document.getElementById('printWrapper').classList.add('active');
        
        setTimeout(() => window.print(), 300);
    },
    closePrintAndReset() {
        document.getElementById('printWrapper').classList.remove('active');
        this.items = [];
        document.getElementById('posCustomer').value = 'Cash Walk-in';
        document.getElementById('posMobile').value = '';
        document.getElementById('billDiscountValue').value = '0';
        this.render();
        InventoryApp.sync();
    }
};

document.getElementById('posSearch').addEventListener('input', () => InventoryApp.filterItems());
document.getElementById('filterCategory').addEventListener('change', () => InventoryApp.filterItems());
document.getElementById('filterBrand').addEventListener('change', () => InventoryApp.filterItems());
document.getElementById('billDiscountValue').addEventListener('input', () => CartApp.render());
document.getElementById('billDiscountType').addEventListener('change', () => CartApp.render());
['payCash', 'payUPI', 'payCard'].forEach(id => {
    document.getElementById(id).addEventListener('input', () => CartApp.calcSplitPay());
});

window.onload = () => {
    InventoryApp.sync();
    document.getElementById('posSearch').focus();
};

// --- NEW ITEM / QUICK ADD LOGIC ---

// Map Alt+C shortcut to open modal
document.addEventListener('keydown', (e) => {
    if (e.altKey && e.code === 'KeyC') {
        e.preventDefault();
        openQuickAdd();
    }
});

function openQuickAdd() {
    // Populate auto-complete dropdowns
    const cats = [...new Set(InventoryApp.products.map(p => p.category))].filter(Boolean);
    const brands = [...new Set(InventoryApp.products.map(p => p.brandname))].filter(Boolean);
    document.getElementById('qCatList').innerHTML = cats.map(c => `<option value="${c}">`).join('');
    document.getElementById('qBrandList').innerHTML = brands.map(b => `<option value="${b}">`).join('');
    
    document.getElementById('quickAddModal').classList.add('active');
    setTimeout(() => document.getElementById('qBarcode').focus(), 50);
}

function toggleItemFields() {
    const target = document.getElementById('qTarget').value;
    if(target === 'icecream') {
        document.getElementById('fields-grocery').style.display = 'none';
        document.getElementById('fields-icecream').style.display = 'flex';
    } else {
        document.getElementById('fields-grocery').style.display = 'flex';
        document.getElementById('fields-icecream').style.display = 'none';
    }
}

let isSavingItem = false;

async function saveNewItem() {
    if (isSavingItem) return; // Prevent double-clicks
    
    const target = document.getElementById('qTarget').value;
    const name = document.getElementById('qName').value.trim();
    const price = document.getElementById('qPrice').value;

    if(!name || !price) {
        alert("Item Name and Selling Rate are mandatory.");
        return;
    }

    isSavingItem = true;
    const btn = document.getElementById('btn-save-item');
    btn.textContent = "⏳ SAVING...";
    btn.disabled = true;
    
    // Immediately hide the modal so the user can't interact with it while saving
    document.getElementById('quickAddModal').classList.remove('active');
    document.getElementById('network-status').textContent = "↻ Syncing New Item...";

    const payload = {
        target: target,
        barcode: document.getElementById('qBarcode').value.trim(),
        name: name,
        category: document.getElementById('qCategory').value.trim(),
        brand: document.getElementById('qBrand').value.trim(),
        mrp: document.getElementById('qMRP').value,
        price: price,
        image: document.getElementById('qImage').value.trim()
    };

    if(target === 'grocery') {
        payload.quantity = document.getElementById('qQty').value || 0;
        payload.moq = document.getElementById('qMOQ').value || 1;
    } else {
        payload.available = document.getElementById('qAvailable').value;
        payload.launchingyear = document.getElementById('qLaunchYear').value; // Will send "YYYY-MM"
        payload.tags = document.getElementById('qTags').value;
        payload.description = document.getElementById('qDesc').value;
        payload.ingredients = document.getElementById('qIng').value;
    }

    try {
        await API.createItem(payload);
        
        // Clear all inputs for the next entry
        ['qBarcode', 'qName', 'qCategory', 'qBrand', 'qMRP', 'qPrice', 'qImage', 'qQty', 'qLaunchYear', 'qTags', 'qDesc', 'qIng'].forEach(id => {
            if(document.getElementById(id)) document.getElementById(id).value = '';
        });
        
        // Force a full synchronous refresh of the grid
        await InventoryApp.sync(); 
        
        alert("Item added successfully!");
    } catch(e) {
        alert("Failed to save item: " + e.message);
        document.getElementById('network-status').textContent = "⚠ Offline Mode";
    } finally {
        isSavingItem = false;
        btn.textContent = "💾 ADD TO DATABASE";
        btn.disabled = false;
    }
}
