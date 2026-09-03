// --- HELPERS & GLOBAL LISTENERS ---
let scanBuffer = "";
let scanTimeout;

const toTitleCase = (str) => {
    if (!str) return '';
    return String(str).toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
};

document.addEventListener('keydown', (e) => {
    if(e.key === 'F4') { e.preventDefault(); CartApp.openPaymentPopup(); return; }
    if (e.altKey && e.code === 'KeyC') { e.preventDefault(); openQuickAdd(); return; }
    
    // NEW: Alt+S focuses and selects text in the search bar
    if (e.altKey && e.code === 'KeyS') { 
        e.preventDefault(); 
        const searchBox = document.getElementById('posSearch');
        if(searchBox) { 
            searchBox.focus(); 
            searchBox.select(); 
        }
        return; 
    }
    
    if(e.key === 'Escape') { 
        document.getElementById('paymentModal')?.classList.remove('active');
        document.getElementById('quickAddModal')?.classList.remove('active');
        if(document.getElementById('printWrapper')?.classList.contains('active')) {
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
                    const searchBox = document.getElementById('posSearch');
                    if (searchBox) searchBox.value = '';
                }
            }
            scanBuffer = "";
        }, 50);
    }
});


// --- INVENTORY & SMART SEARCH LOGIC ---
const InventoryApp = {
    products: [],
    filteredProducts: [],
    displayCount: 0,
    chunkSize: 40,
    activeTag: '',

    sync: async function() {
        const btn = document.getElementById('network-status');
        if (btn) {
            btn.textContent = "↻ Syncing...";
            btn.style.color = "white";
            btn.style.background = "#f59e0b"; // Warning orange
            btn.disabled = true;
        }

        try {
            const data = await API.getInventory();
            this.products = data;
            this.extractFilters();
            this.filterItems();
            
            if (btn) {
                btn.textContent = "↻ Sync Data";
                btn.style.background = "#10b981"; // Success green
                setTimeout(() => btn.style.background = "", 3000); // Revert to normal dark theme after 3s
            }
        } catch (error) {
            console.error("Sync failed:", error);
            if (btn) {
                btn.textContent = "⚠️ Sync Failed (Retry)";
                btn.style.background = "#ef4444"; // Error red
            }
            // If we have 0 products, alert the user. If we already have products loaded, 
            // fail silently so the cashier can keep ringing up items from memory.
            if (this.products.length === 0) {
                alert("Failed to load inventory. Please check your internet connection and try again.");
            }
        } finally {
            if (btn) btn.disabled = false;
        }
    },

    populateFilters() {
        const cats = [...new Set(this.products.map(p => p.category))].filter(Boolean).sort((a, b) => a.localeCompare(b));
        const brands = [...new Set(this.products.map(p => p.brandname))].filter(Boolean).sort((a, b) => a.localeCompare(b));
        
        const catSelect = document.getElementById('filterCategory');
        const brandSelect = document.getElementById('filterBrand');
        if(catSelect) catSelect.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option value="${c}">${c}</option>`).join('');
        if(brandSelect) brandSelect.innerHTML = '<option value="">All Brands</option>' + brands.map(b => `<option value="${b}">${b}</option>`).join('');

        let allTags = new Set();
        this.products.forEach(p => {
            if(p.tags) {
                p.tags.split(',').forEach(t => {
                    let cleanTag = toTitleCase(t.trim());
                    if(cleanTag) allTags.add(cleanTag);
                });
            }
        });
        
        const tagContainer = document.getElementById('tagFilters');
        if(tagContainer) {
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
        }
    },

    setTag(tag) {
        this.activeTag = tag;
        this.populateFilters();
        this.filterItems();
    },

    clearFilters() {
        if(document.getElementById('posSearch')) document.getElementById('posSearch').value = '';
        if(document.getElementById('filterCategory')) document.getElementById('filterCategory').value = '';
        if(document.getElementById('filterBrand')) document.getElementById('filterBrand').value = '';
        if(document.getElementById('filterMinPrice')) document.getElementById('filterMinPrice').value = '';
        if(document.getElementById('filterMaxPrice')) document.getElementById('filterMaxPrice').value = '';
        this.activeTag = '';
        this.populateFilters();
        this.filterItems();
        if(document.getElementById('posSearch')) document.getElementById('posSearch').focus();
    },

    filterItems() {
        const searchBox = document.getElementById('posSearch');
        const rawQuery = searchBox ? searchBox.value : '';
        const queryWords = rawQuery.toLowerCase().split(/\s+/).filter(Boolean);
        
        const cat = document.getElementById('filterCategory') ? document.getElementById('filterCategory').value : '';
        const brand = document.getElementById('filterBrand') ? document.getElementById('filterBrand').value : '';
        const minPrice = document.getElementById('filterMinPrice') ? parseFloat(document.getElementById('filterMinPrice').value) || 0 : 0;
        const maxPrice = document.getElementById('filterMaxPrice') ? parseFloat(document.getElementById('filterMaxPrice').value) || Infinity : Infinity;
        
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

        this.filteredProducts.sort((a, b) => {
            const stockA = parseFloat(a.quantity) || 0;
            const stockB = parseFloat(b.quantity) || 0;
            const isOosA = stockA <= 0 ? 1 : 0;
            const isOosB = stockB <= 0 ? 1 : 0;

            if (isOosA !== isOosB) return isOosA - isOosB; 
            return a.itemname.localeCompare(b.itemname); 
        });

        this.displayCount = 0;
        const grid = document.getElementById('itemGrid');
        if(grid) grid.innerHTML = '';
        this.loadMoreItems();
    },

    loadMoreItems() {
        const grid = document.getElementById('itemGrid');
        if(!grid) return;

        const existingBtn = document.getElementById('inlineLoadMoreBtn');
        if(existingBtn) existingBtn.remove();

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

        if (this.displayCount < this.filteredProducts.length) {
            const btnContainer = document.createElement('div');
            btnContainer.id = 'inlineLoadMoreBtn';
            btnContainer.className = 'inline-load-more';
            btnContainer.innerHTML = `<button class="btn-load-more" onclick="InventoryApp.loadMoreItems()">Load More Items ⬇</button>`;
            grid.appendChild(btnContainer);
        }
    }
};


// --- CART LOGIC ---
const CartApp = {
    items: [],

    // --- NEW: CLEAR & HOLD BILL LOGIC ---
    clearCart() {
        if (this.items.length === 0) return;
        if (confirm("Are you sure you want to completely clear the cart?")) {
            this.items = [];
            const cust = document.getElementById('posCustomer');
            const mob = document.getElementById('posMobile');
            const dis = document.getElementById('billDiscountValue');
            if(cust) cust.value = '';
            if(mob) mob.value = '';
            if(dis) dis.value = '0';
            this.render();
        }
    },
    holdBill() {
        if (this.items.length === 0) return alert("Cart is empty!");
        const custName = document.getElementById('posCustomer')?.value || 'Walk-in';
        const total = document.getElementById('cartGrandTotal')?.innerText || '₹0.00';
        
        const bill = {
            id: Date.now().toString(),
            customer: custName,
            mobile: document.getElementById('posMobile')?.value || '',
            discountType: document.getElementById('billDiscountType')?.value || 'Amt',
            discountValue: document.getElementById('billDiscountValue')?.value || '0',
            items: JSON.parse(JSON.stringify(this.items)),
            total: total,
            time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
        };
        
        let holds = JSON.parse(localStorage.getItem('glacier_holds') || '[]');
        holds.push(bill);
        localStorage.setItem('glacier_holds', JSON.stringify(holds));
        
        // Clear cart silently after holding
        this.items = [];
        if(document.getElementById('posCustomer')) document.getElementById('posCustomer').value = '';
        if(document.getElementById('posMobile')) document.getElementById('posMobile').value = '';
        if(document.getElementById('billDiscountValue')) document.getElementById('billDiscountValue').value = '0';
        this.render();
    },
    openRecallModal() {
        const holds = JSON.parse(localStorage.getItem('glacier_holds') || '[]');
        const container = document.getElementById('heldBillsContainer');
        container.innerHTML = '';
        
        if (holds.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-muted);">No bills currently on hold.</div>';
        } else {
            holds.forEach(h => {
                container.innerHTML += `
                    <div class="held-bill-card">
                        <div>
                            <div style="font-weight: bold; font-size: 14px; color: var(--primary);">${h.customer} <span style="font-size: 11px; color: var(--text-muted); font-weight: normal;">(${h.time})</span></div>
                            <div style="font-size: 12px; color: var(--text-muted);">${h.items.length} items | Total: <span style="color:var(--danger); font-weight:bold;">${h.total}</span></div>
                        </div>
                        <div style="display: flex; gap: 5px;">
                            <button class="btn btn-success" style="padding: 5px 12px; font-size: 12px;" onclick="CartApp.resumeBill('${h.id}')">▶ Resume</button>
                            <button class="btn btn-danger-outline" style="padding: 5px 10px; font-size: 12px;" onclick="CartApp.deleteHeldBill('${h.id}')">🗑️</button>
                        </div>
                    </div>
                `;
            });
        }
        document.getElementById('recallModal').classList.add('active');
    },
    resumeBill(id) {
        if (this.items.length > 0) {
            if (!confirm("Your current cart is not empty! Resuming will overwrite it. Put the current bill on hold first?")) return;
        }
        let holds = JSON.parse(localStorage.getItem('glacier_holds') || '[]');
        const billIndex = holds.findIndex(h => h.id === id);
        if (billIndex === -1) return;
        
        const bill = holds[billIndex];
        this.items = bill.items;
        if(document.getElementById('posCustomer')) document.getElementById('posCustomer').value = bill.customer === 'Walk-in' ? '' : bill.customer;
        if(document.getElementById('posMobile')) document.getElementById('posMobile').value = bill.mobile;
        if(document.getElementById('billDiscountType')) document.getElementById('billDiscountType').value = bill.discountType;
        if(document.getElementById('billDiscountValue')) document.getElementById('billDiscountValue').value = bill.discountValue;
        
        // Remove from holds once resumed
        holds.splice(billIndex, 1);
        localStorage.setItem('glacier_holds', JSON.stringify(holds));
        
        document.getElementById('recallModal').classList.remove('active');
        this.render();
    },
    deleteHeldBill(id) {
        if(!confirm("Delete this held bill permanently?")) return;
        let holds = JSON.parse(localStorage.getItem('glacier_holds') || '[]');
        holds = holds.filter(h => h.id !== id);
        localStorage.setItem('glacier_holds', JSON.stringify(holds));
        this.openRecallModal(); // Refresh UI list immediately
    },
    // --- END NEW LOGIC ---

    
    addItem(product) {
        const existing = this.items.find(i => i.barcode === product.barcode && i.itemName === product.itemname);
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
        
        // NEW: Force focus back to search bar instantly after clicking an item
        const searchBox = document.getElementById('posSearch');
        if (searchBox) searchBox.focus();
    },
    updateField(index, field, val) {
        const item = this.items[index];
        if(item) {
            item[field] = field === 'qty' ? (parseInt(val, 10) || 1) : (parseFloat(val) || 0);
            this.render();
        }
    },
    removeItem(index) {
        this.items.splice(index, 1);
        this.render();
    },
    render() {
        const tbody = document.getElementById('cartBody');
        if(!tbody) return;
        
        tbody.innerHTML = '';
        let subtotal = 0;
        let totalItems = 0;

        this.items.forEach((c, index) => {
            const gross = c.qty * c.rate;
            const disAmt = gross * (c.discountPerc / 100);
            const net = gross - disAmt;
            subtotal += net;
            totalItems += c.qty;

            tbody.innerHTML += `
                <li class="cart-item">
                    <div style="flex: 2; font-weight:600; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;" title="${c.itemName}">${c.itemName}</div>
                    <div style="flex: 0.8;"><input type="number" class="cart-item-input" value="${c.qty}" onchange="CartApp.updateField(${index}, 'qty', this.value)" min="1"></div>
                    <div style="flex: 1;"><input type="number" class="cart-item-input" value="${c.rate}" onchange="CartApp.updateField(${index}, 'rate', this.value)" min="0" step="0.01"></div>
                    <div style="flex: 0.8;"><input type="number" class="cart-item-input" value="${c.discountPerc}" onchange="CartApp.updateField(${index}, 'discountPerc', this.value)" min="0" max="100" step="0.01"></div>
                    <div style="flex: 1; font-weight:bold; text-align:right;">₹${net.toFixed(2)}</div>
                    <div style="width: 25px; text-align:right;"><button class="btn-del" onclick="CartApp.removeItem(${index})">×</button></div>
                </li>
            `;
        });

        const bType = document.getElementById('billDiscountType') ? document.getElementById('billDiscountType').value : 'Amt';
        const bVal = document.getElementById('billDiscountValue') ? parseFloat(document.getElementById('billDiscountValue').value) || 0 : 0;
        let billDisAmt = bType === 'Amt' ? bVal : subtotal * (bVal / 100);
        
        const netBeforeRound = subtotal - billDisAmt;
        const finalPayable = Math.round(netBeforeRound);
        const roundOff = finalPayable - netBeforeRound;

        if(document.getElementById('cartQtySummary')) document.getElementById('cartQtySummary').innerText = `${totalItems} Qty (${this.items.length} Types)`;
        if(document.getElementById('cartSubtotal')) document.getElementById('cartSubtotal').innerText = `₹${subtotal.toFixed(2)}`;
        if(document.getElementById('cartRoundOff')) document.getElementById('cartRoundOff').innerText = `${roundOff > 0 ? '+' : ''}${roundOff.toFixed(2)}`;
        if(document.getElementById('cartGrandTotal')) document.getElementById('cartGrandTotal').innerText = `₹${Math.max(0, finalPayable).toFixed(2)}`;
        
        if(document.getElementById('paymentModal') && document.getElementById('paymentModal').classList.contains('active')) this.calcSplitPay();
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
        
        if(!lbl || !box) return;

        if (balance > 0) { lbl.innerText = "Due"; lbl.style.color = "var(--danger)"; box.style.color = "var(--danger)"; box.value = balance.toFixed(2); } 
        else if (balance < 0) { lbl.innerText = "Change"; lbl.style.color = "var(--success)"; box.style.color = "var(--success)"; box.value = Math.abs(balance).toFixed(2); } 
        else { lbl.innerText = "Settled"; lbl.style.color = "var(--text-main)"; box.style.color = "var(--text-main)"; box.value = "0.00"; }
    },
    isCheckingOut: false,
    async checkout() {
        if (this.isCheckingOut) return; 
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
        if(document.getElementById('posCustomer')) document.getElementById('posCustomer').value = 'Cash Walk-in';
        if(document.getElementById('posMobile')) document.getElementById('posMobile').value = '';
        if(document.getElementById('billDiscountValue')) document.getElementById('billDiscountValue').value = '0';
        this.render();
        InventoryApp.sync();
    }
};

// --- NEW ITEM LOGIC ---
let isSavingItem = false;

function openQuickAdd() {
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

async function saveNewItem() {
    if (isSavingItem) return; 
    
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
    
    document.getElementById('quickAddModal').classList.remove('active');
    const netStatus = document.getElementById('network-status');
    if(netStatus) netStatus.textContent = "↻ Syncing New Item...";

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
        payload.launchingyear = document.getElementById('qLaunchYear').value; 
        payload.tags = document.getElementById('qTags').value;
        payload.description = document.getElementById('qDesc').value;
        payload.ingredients = document.getElementById('qIng').value;
    }

    try {
        await API.createItem(payload);
        
        ['qBarcode', 'qName', 'qCategory', 'qBrand', 'qMRP', 'qPrice', 'qImage', 'qQty', 'qLaunchYear', 'qTags', 'qDesc', 'qIng'].forEach(id => {
            if(document.getElementById(id)) document.getElementById(id).value = '';
        });
        
        await InventoryApp.sync(); 
        alert("Item added successfully!");
    } catch(e) {
        alert("Failed to save item: " + e.message);
        if(netStatus) netStatus.textContent = "⚠ Offline Mode";
    } finally {
        isSavingItem = false;
        btn.textContent = "💾 ADD TO DATABASE";
        btn.disabled = false;
    }
}

// --- MOBILE CAMERA SCANNER LOGIC ---
let html5QrcodeScanner = null;

function startMobileScanner() {
    document.getElementById('scannerModal').classList.add('active');
    
    html5QrcodeScanner = new Html5Qrcode("reader");
    html5QrcodeScanner.start(
        { facingMode: "environment" }, // Uses the back camera
        { fps: 10, qrbox: { width: 250, height: 150 } },
        (decodedText) => {
            // On Success: Stop camera, find item, add to cart
            stopMobileScanner();
            
            const scanVal = decodedText.trim().toLowerCase();
            const prod = InventoryApp.products.find(p => p.barcode && p.barcode.toString().trim().toLowerCase() === scanVal);
            
            if (prod) {
                CartApp.addItem(prod);
                if(document.getElementById('posSearch')) document.getElementById('posSearch').value = '';
                InventoryApp.filterItems();
            } else {
                alert(`Barcode [${decodedText}] not found in database!`);
            }
        },
        (errorMessage) => { /* Ignore background scanning noise */ }
    ).catch(err => {
        alert("Camera permission denied or error: " + err);
        stopMobileScanner();
    });
}

function stopMobileScanner() {
    document.getElementById('scannerModal').classList.remove('active');
    if (html5QrcodeScanner) {
        html5QrcodeScanner.stop().catch(e => console.log(e));
        html5QrcodeScanner = null;
    }
}
// --- INITIALIZATION ---
window.onload = () => {
    // --- Search & Barcode Scanner Events ---
    const searchBox = document.getElementById('posSearch');
    if (searchBox) {
        searchBox.addEventListener('input', () => InventoryApp.filterItems());
        
        // Intercept Barcode Scanner's "Enter" key
        searchBox.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // Prevent form submission
                
                const scanVal = searchBox.value.trim().toLowerCase();
                if (!scanVal) return;
                
                // Find exact barcode match
                const prod = InventoryApp.products.find(p => p.barcode && p.barcode.toString().trim().toLowerCase() === scanVal);
                
                if (prod) {
                    CartApp.addItem(prod);
                    searchBox.value = ''; // Clear search bar
                    InventoryApp.filterItems(); // Reset grid visually
                }
                // Optional: You can add an else{} statement here to play an error beep if the barcode isn't found
            }
        });
    }

    // --- Standard Filter Events ---
    document.getElementById('filterCategory')?.addEventListener('change', () => InventoryApp.filterItems());
    document.getElementById('filterBrand')?.addEventListener('change', () => InventoryApp.filterItems());
    document.getElementById('filterMinPrice')?.addEventListener('input', () => InventoryApp.filterItems());
    document.getElementById('filterMaxPrice')?.addEventListener('input', () => InventoryApp.filterItems());
    
    // --- Cart & Payment Events ---
    document.getElementById('billDiscountValue')?.addEventListener('input', () => CartApp.render());
    document.getElementById('billDiscountType')?.addEventListener('change', () => CartApp.render());
    ['payCash', 'payUPI', 'payCard'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', () => CartApp.calcSplitPay());
    });

    InventoryApp.sync();
    document.getElementById('posSearch')?.focus();
};

