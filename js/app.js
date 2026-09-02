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

// --- TITLE CASE HELPER ---
const toTitleCase = (str) => {
    if (!str) return '';
    return String(str).toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
};

// --- INVENTORY & SMART SEARCH LOGIC ---
const InventoryApp = {
    products: [],
    filteredProducts: [],
    displayCount: 0,
    chunkSize: 40,
    activeTag: '', // Tracks the currently clicked tag

    async sync() {
        try {
            const btn = document.getElementById('network-status');
            btn.textContent = "↻ Syncing...";
            const rawProducts = await API.getInventory();
            
            // Normalize all names, brands, and categories to Title Case
            this.products = rawProducts.map(p => ({
                ...p,
                itemname: toTitleCase(p.itemname),
                brandname: toTitleCase(p.brandname),
                category: toTitleCase(p.category)
            }));

            btn.textContent = "↻ Sync Data";
            this.populateFilters();
            this.filterItems(); 
        } catch (err) {
            document.getElementById('network-status').textContent = "⚠ Offline Mode";
        }
    },

    initScroll() {
        const grid = document.getElementById('itemGrid');
        grid.addEventListener('scroll', () => {
            if (grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 300) {
                if (this.displayCount < this.filteredProducts.length) {
                    this.loadMoreItems();
                }
            }
        });
    },

    populateFilters() {
        // Sort Categories and Brands Alphabetically
        const cats = [...new Set(this.products.map(p => p.category))].filter(Boolean).sort((a, b) => a.localeCompare(b));
        const brands = [...new Set(this.products.map(p => p.brandname))].filter(Boolean).sort((a, b) => a.localeCompare(b));
        
        const catSelect = document.getElementById('filterCategory');
        const brandSelect = document.getElementById('filterBrand');
        catSelect.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option value="${c}">${c}</option>`).join('');
        brandSelect.innerHTML = '<option value="">All Brands</option>' + brands.map(b => `<option value="${b}">${b}</option>`).join('');

        // Extract, Normalize, and Sort Unique Tags
        let allTags = new Set();
        this.products.forEach(p => {
            if(p.tags) {
                p.tags.split(',').forEach(t => {
                    let cleanTag = toTitleCase(t.trim());
                    if(cleanTag) allTags.add(cleanTag);
                });
            }
        });
        
        // Render Single-Click Tag Buttons
        const tagContainer = document.getElementById('tagFilters');
        if(allTags.size > 0) {
            const tagsArr = [...allTags].sort((a, b) => a.localeCompare(b));
            let tagsHTML = `<button class="tag-chip ${this.activeTag === '' ? 'active' : ''}" onclick="InventoryApp.setTag('')">All Tags</button>`;
            tagsArr.forEach(t => {
                tagsHTML += `<button class="tag-chip ${this.activeTag === t ? 'active' : ''}" onclick="InventoryApp.setTag('${t.replace(/'/g, "\\'")}')">${t}</button>`;
            });
            tagContainer.innerHTML = tagsHTML;
            tagContainer.style.display = 'flex';
        } else {
            tagContainer.style.display = 'none';
        }
    },

    setTag(tag) {
        this.activeTag = tag;
        this.populateFilters(); // Re-render to update the 'active' highlight
        this.filterItems();
    },

    clearFilters() {
        document.getElementById('posSearch').value = '';
        document.getElementById('filterCategory').value = '';
        document.getElementById('filterBrand').value = '';
        document.getElementById('filterMinPrice').value = '';
        document.getElementById('filterMaxPrice').value = '';
        this.activeTag = '';
        this.populateFilters();
        this.filterItems();
        document.getElementById('posSearch').focus();
    },

    filterItems() {
        const rawQuery = document.getElementById('posSearch').value;
        const queryWords = rawQuery.toLowerCase().split(/\s+/).filter(Boolean);
        const cat = document.getElementById('filterCategory').value;
        const brand = document.getElementById('filterBrand').value;
        const minPrice = parseFloat(document.getElementById('filterMinPrice').value) || 0;
        const maxPrice = parseFloat(document.getElementById('filterMaxPrice').value) || Infinity;
        
        // Toggle Clear button visibility based on ALL filters
        const clearBtn = document.getElementById('searchClearBtn');
        if (clearBtn) {
            clearBtn.style.display = (rawQuery !== '' || cat !== '' || brand !== '' || minPrice > 0 || maxPrice !== Infinity || this.activeTag !== '') ? 'block' : 'none';
        }
        
        this.filteredProducts = this.products.filter(p => {
            const searchString = `${p.itemname} ${p.barcode || ''} ${p.brandname || ''} ${p.category || ''} ${p.tags || ''}`.toLowerCase();
            const matchSearch = queryWords.every(word => searchString.includes(word));
            const matchCat = cat === '' || p.category === cat;
            const matchBrand = brand === '' || p.brandname === brand;
            
            const price = parseFloat(p.sellingrate) || 0;
            const matchPrice = price >= minPrice && price <= maxPrice;
            
            let matchTag = true;
            if(this.activeTag !== '') {
                const itemTags = p.tags ? p.tags.split(',').map(t => toTitleCase(t.trim())) : [];
                matchTag = itemTags.includes(this.activeTag);
            }
            
            return matchSearch && matchCat && matchBrand && matchPrice && matchTag;
        });

        // Sorting: In-stock items first, 0 stock items at the very bottom, alphabetically
        this.filteredProducts.sort((a, b) => {
            const stockA = parseFloat(a.quantity) || 0;
            const stockB = parseFloat(b.quantity) || 0;
            const isOosA = stockA <= 0 ? 1 : 0;
            const isOosB = stockB <= 0 ? 1 : 0;

            if (isOosA !== isOosB) return isOosA - isOosB; 
            return a.itemname.localeCompare(b.itemname); 
        });

        this.displayCount = 0;
        document.getElementById('itemGrid').innerHTML = '';
        this.loadMoreItems();
    },

    loadMoreItems() {
        const grid = document.getElementById('itemGrid');
        const toLoad = this.filteredProducts.slice(this.displayCount, this.displayCount + this.chunkSize);

        toLoad.forEach(p => {
            const stock = parseFloat(p.quantity) || 0;
            const rate = parseFloat(p.sellingrate) || 0;
            const isOOS = stock <= 0;
            
            let badgeClass = isOOS ? 'stock-badge low' : 'stock-badge';
            
            const card = document.createElement('button');
            card.className = `item-card ${isOOS ? 'oos-card' : ''}`;
            card.type = 'button';
            
            if (isOOS) { card.disabled = true; } 
            else { card.onclick = () => CartApp.addItem(p); }
            
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

        this.displayCount += toLoad.length;

        // Toggle "Load More" button visibility
        const loadMoreContainer = document.getElementById('loadMoreContainer');
        if (loadMoreContainer) {
            if (this.displayCount < this.filteredProducts.length) {
                loadMoreContainer.style.display = 'flex';
            } else {
                loadMoreContainer.style.display = 'none';
            }
        }
    }
};

// --- INITIALIZATION ---
window.onload = () => {
    document.getElementById('filterMinPrice').addEventListener('input', () => InventoryApp.filterItems());
    document.getElementById('filterMaxPrice').addEventListener('input', () => InventoryApp.filterItems());
    
    // Removed initScroll() here
    InventoryApp.sync();
    document.getElementById('posSearch').focus();
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
   isCheckingOut: false,
    async checkout() {
        if (this.isCheckingOut) return; // Prevent double clicks hanging the UI
        this.isCheckingOut = true;
        
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
            this.isCheckingOut = false;
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
