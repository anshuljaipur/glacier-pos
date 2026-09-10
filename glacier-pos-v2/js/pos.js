// ============================================================
// POS billing page (index.html)
// ============================================================

const InventoryApp = {
    products: [],
    filtered: [],
    renderCount: 40,
    unsubscribe: null,

    init() {
        this.unsubscribe = listenProducts(
            (list) => {
                this.products = list;
                this.setPill('ok', '● Live');
                this.populateFilters();
                this.applyFilters();
            },
            (err) => this.setPill('bad', '⚠ Connection issue')
        );
        window.addEventListener('online', () => this.setPill('ok', '● Live'));
        window.addEventListener('offline', () => this.setPill('bad', '⚠ Offline'));
    },

    setPill(cls, text) {
        const pill = document.getElementById('sync-pill');
        if (!pill) return;
        pill.className = 'sync-pill ' + cls;
        pill.textContent = text;
    },

    populateFilters() {
        const catSel = document.getElementById('filterCategory');
        const brandSel = document.getElementById('filterBrand');
        if (!catSel || !brandSel) return;
        const cats = [...new Set(this.products.map(p => p.category).filter(Boolean))].sort();
        const brands = [...new Set(this.products.map(p => p.brandname).filter(Boolean))].sort();
        const keepCat = catSel.value, keepBrand = brandSel.value;
        catSel.innerHTML = '<option value="">All Categories</option>' + cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
        brandSel.innerHTML = '<option value="">All Brands</option>' + brands.map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
        catSel.value = keepCat; brandSel.value = keepBrand;
    },

    applyFilters() {
        const search = (document.getElementById('posSearch')?.value || '').toLowerCase().trim();
        const cat = document.getElementById('filterCategory')?.value || '';
        const brand = document.getElementById('filterBrand')?.value || '';
        const min = parseFloat(document.getElementById('minPrice')?.value) || 0;
        const max = parseFloat(document.getElementById('maxPrice')?.value) || Infinity;

        this.filtered = this.products.filter(p => {
            const name = (p.itemname || '').toLowerCase();
            const barcode = (p.barcode || '').toLowerCase();
            const matchesSearch = !search || name.includes(search) || barcode.includes(search);
            const matchesCat = !cat || p.category === cat;
            const matchesBrand = !brand || p.brandname === brand;
            const rate = parseFloat(p.rate) || 0;
            const matchesPrice = rate >= min && rate <= max;
            return matchesSearch && matchesCat && matchesBrand && matchesPrice;
        });
        this.renderCount = 40;
        this.render();
    },

    render() {
        const grid = document.getElementById('productGrid');
        if (!grid) return;
        const toShow = this.filtered.slice(0, this.renderCount);

        if (toShow.length === 0) {
            grid.innerHTML = `<div class="empty-state">No items match your filters.</div>`;
        } else {
            grid.innerHTML = toShow.map(p => {
                const qty = parseFloat(p.quantity) || 0;
                const moq = parseFloat(p.moq) || 0;
                const oos = qty <= 0;
                const low = !oos && moq > 0 && qty <= moq;
                const badge = oos ? '<span class="badge oos">OOS</span>' : (low ? '<span class="badge low">LOW</span>' : '');
                return `
                <button class="product-card ${oos ? 'oos' : ''}" ${oos ? 'disabled' : ''} data-id="${p.id}">
                    ${badge}
                    <img src="${resolveImage(p.image)}" loading="lazy" onerror="this.src='${resolveImage(null)}'">
                    <div class="pname">${escapeHtml(p.itemname)}</div>
                    <div class="prate">${fmtMoney(p.rate)}</div>
                </button>`;
            }).join('');
        }

        const wrap = document.getElementById('loadMoreWrap');
        if (wrap) {
            wrap.innerHTML = this.filtered.length > this.renderCount
                ? `<button class="btn btn-outline btn-block" id="btn-load-more">Show more (${this.filtered.length - this.renderCount} left)</button>`
                : '';
            const btn = document.getElementById('btn-load-more');
            if (btn) btn.addEventListener('click', () => { this.renderCount += 40; this.render(); });
        }

        grid.querySelectorAll('.product-card').forEach(card => {
            card.addEventListener('click', () => {
                const p = this.products.find(x => x.id === card.dataset.id);
                if (p) CartApp.addItem(p);
            });
        });
    }
};

function resolveImage(url) {
    if (!url) return 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjNmNGY2Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiM5Y2EzYWYiPk5vIEltYWdlPC90ZXh0Pjwvc3ZnPg==';
    return url;
}

const CartApp = {
    items: [], // { barcode, itemName, rate, mrp, qty, discountPerc }
    isCheckingOut: false,

    addItem(product, qty = 1) {
        const returnMode = document.getElementById('chkReturnMode')?.checked;
        const signedQty = returnMode ? -Math.abs(qty) : Math.abs(qty);
        const existing = this.items.find(i => i.barcode === product.barcode);
        if (existing) {
            existing.qty += signedQty;
        } else {
            this.items.push({
                barcode: product.barcode,
                itemName: product.itemname,
                rate: parseFloat(product.rate) || 0,
                mrp: parseFloat(product.mrp) || 0,
                qty: signedQty,
                discountPerc: 0
            });
        }
        this.render();
        document.getElementById('posSearch')?.focus();
    },
    removeItem(idx) { this.items.splice(idx, 1); this.render(); },
    clear() {
        this.items = [];
        document.getElementById('posCustomer').value = '';
        document.getElementById('posMobile').value = '';
        document.getElementById('billDiscountValue').value = 0;
        document.getElementById('chkReturnMode').checked = false;
        this.render();
    },

    computeTotals() {
        const subtotal = this.items.reduce((sum, i) => {
            const gross = i.qty * i.rate;
            const disAmt = gross * (i.discountPerc / 100);
            return sum + (gross - disAmt);
        }, 0);
        const bType = document.getElementById('billDiscountType')?.value || 'Amt';
        const bVal = parseFloat(document.getElementById('billDiscountValue')?.value) || 0;
        const billDiscount = bType === 'Amt' ? bVal : subtotal * (bVal / 100);
        const netBeforeRound = subtotal - billDiscount;
        const total = Math.round(netBeforeRound);
        const roundOff = total - netBeforeRound;
        return { subtotal, billDiscount, roundOff, total };
    },

    render() {
        const body = document.getElementById('cartItemsBody');
        if (!body) return;
        if (this.items.length === 0) {
            body.innerHTML = `<div class="empty-state">Cart is empty. Tap an item or scan a barcode.</div>`;
        } else {
            body.innerHTML = this.items.map((i, idx) => `
                <div class="cart-item">
                    <div class="cart-name" title="${escapeHtml(i.itemName)}">${escapeHtml(i.itemName)}</div>
                    <input type="number" value="${i.qty}" step="1" onchange="CartApp.setField(${idx}, 'qty', this.value)">
                    <input type="number" value="${i.rate}" step="0.01" onchange="CartApp.setField(${idx}, 'rate', this.value)">
                    <input type="number" value="${i.discountPerc}" step="1" onchange="CartApp.setField(${idx}, 'discountPerc', this.value)">
                    <div>${fmtMoney((i.rate * i.qty) - (i.qty * i.rate * i.discountPerc / 100))}</div>
                    <button onclick="CartApp.removeItem(${idx})" style="background:none;border:none;color:var(--red);cursor:pointer;font-weight:800;">×</button>
                </div>
            `).join('');
        }

        const totals = this.computeTotals();
        const typeCount = this.items.length;
        const qtyCount = this.items.reduce((s, i) => s + Math.abs(i.qty), 0);
        document.getElementById('cartCount').textContent = `${qtyCount} Qty (${typeCount} types)`;
        document.getElementById('cartSubtotal').textContent = fmtMoney(totals.subtotal);
        document.getElementById('cartRoundOff').textContent = totals.roundOff.toFixed(2);
        document.getElementById('cartGrandTotal').textContent = fmtMoney(totals.total);
    },
    setField(idx, field, value) {
        const num = parseFloat(value);
        this.items[idx][field] = isNaN(num) ? 0 : num;
        this.render();
    },

    async hold() {
        if (this.items.length === 0) return toast('Cart is empty — nothing to hold.', 'error');
        try {
            await holdBill({
                customer: document.getElementById('posCustomer').value || '',
                mobile: document.getElementById('posMobile').value || '',
                billDiscountType: document.getElementById('billDiscountType').value,
                billDiscountValue: parseFloat(document.getElementById('billDiscountValue').value) || 0,
                items: this.items
            });
            toast('Bill held. Recall it anytime from any terminal.', 'success');
            this.clear();
        } catch (e) {
            console.error(e);
            toast('Could not hold bill: ' + e.message, 'error');
        }
    },

    async openRecall() {
        openModal('recallModal');
        const list = document.getElementById('recallList');
        list.innerHTML = `<div class="empty-state">Loading…</div>`;
        try {
            const bills = await getHeldBills();
            if (bills.length === 0) {
                list.innerHTML = `<div class="empty-state">No held bills.</div>`;
                return;
            }
            list.innerHTML = bills.map(b => `
                <div class="flex-between" style="padding:10px;border-bottom:1px solid var(--border);">
                    <div>
                        <div style="font-weight:700;">${escapeHtml(b.customer || 'Walk-in')}</div>
                        <div class="text-muted" style="font-size:12px;">${b.items.length} items</div>
                    </div>
                    <div class="flex">
                        <button class="btn btn-primary btn-sm" onclick="CartApp.resume('${b.id}')">Resume</button>
                        <button class="btn btn-danger btn-sm" onclick="CartApp.discardHeld('${b.id}')">Delete</button>
                    </div>
                </div>
            `).join('');
        } catch (e) {
            list.innerHTML = `<div class="empty-state">Failed to load held bills.</div>`;
        }
    },
    async resume(id) {
        try {
            const bills = await getHeldBills();
            const bill = bills.find(b => b.id === id);
            if (!bill) return toast('That held bill is gone.', 'error');
            this.items = bill.items;
            document.getElementById('posCustomer').value = bill.customer || '';
            document.getElementById('posMobile').value = bill.mobile || '';
            document.getElementById('billDiscountType').value = bill.billDiscountType || 'Amt';
            document.getElementById('billDiscountValue').value = bill.billDiscountValue || 0;
            await deleteHeldBill(id);
            this.render();
            closeModal('recallModal');
        } catch (e) {
            toast('Could not resume bill: ' + e.message, 'error');
        }
    },
    async discardHeld(id) {
        await deleteHeldBill(id);
        this.openRecall();
    },

    openPaymentPopup() {
        if (this.items.length === 0) return toast('Cart is empty.', 'error');
        const totals = this.computeTotals();
        document.getElementById('payModalTotal').textContent = fmtMoney(totals.total);
        document.getElementById('payCash').value = totals.total.toFixed(2);
        document.getElementById('payUPI').value = 0;
        document.getElementById('payCard').value = 0;
        this.calcSplitPay();
        openModal('paymentModal');
        setTimeout(() => document.getElementById('payCash')?.focus(), 50);
    },
    calcSplitPay() {
        const totals = this.computeTotals();
        const cash = parseFloat(document.getElementById('payCash').value) || 0;
        const upi = parseFloat(document.getElementById('payUPI').value) || 0;
        const card = parseFloat(document.getElementById('payCard').value) || 0;
        const paid = cash + upi + card;
        const balance = paid - totals.total;
        const lbl = document.getElementById('lblBalance');
        const bal = document.getElementById('payBalance');
        lbl.textContent = balance >= 0 ? 'Change Due:' : 'Balance Due:';
        bal.textContent = fmtMoney(Math.abs(balance));
        bal.style.color = balance >= 0 ? 'var(--green)' : 'var(--red)';
    },

    async checkout() {
        if (this.isCheckingOut) return;
        if (this.items.length === 0) return toast('Cart is empty.', 'error');
        this.isCheckingOut = true;
        const btn = document.getElementById('btn-confirm-payment');
        if (btn) { btn.disabled = true; btn.textContent = 'Processing…'; }

        try {
            const cash = parseFloat(document.getElementById('payCash').value) || 0;
            const upi = parseFloat(document.getElementById('payUPI').value) || 0;
            const card = parseFloat(document.getElementById('payCard').value) || 0;
            const modes = [];
            if (cash > 0) modes.push('Cash');
            if (upi > 0) modes.push('UPI');
            if (card > 0) modes.push('Card');

            const totals = this.computeTotals();
            const returnMode = document.getElementById('chkReturnMode')?.checked;

            const payload = {
                type: returnMode ? 'Return' : 'Sale',
                customer: document.getElementById('posCustomer').value || 'Walk-in',
                mobile: document.getElementById('posMobile').value || '',
                paymentMode: modes.length > 1 ? 'Split' : (modes[0] || 'Cash'),
                items: this.items.map(i => ({
                    barcode: i.barcode,
                    itemName: i.itemName,
                    quantity: i.qty,
                    rate: i.rate,
                    discount: (i.qty * i.rate) * (i.discountPerc / 100),
                    amount: (i.rate * i.qty) - ((i.qty * i.rate) * (i.discountPerc / 100))
                })),
                subtotal: totals.subtotal,
                billDiscount: totals.billDiscount,
                roundOff: totals.roundOff,
                total: totals.total
            };

            const result = await saveVoucherAndAdjustStock(payload);
            toast(`Saved ${result.invoiceNo}`, 'success');
            this.printReceipt({ ...payload, invoiceNo: result.invoiceNo, date: todayStr() });
            closeModal('paymentModal');
            this.clear();
        } catch (e) {
            console.error(e);
            toast('Checkout failed: ' + e.message, 'error');
        } finally {
            this.isCheckingOut = false;
            if (btn) { btn.disabled = false; btn.textContent = 'Confirm & Print'; }
        }
    },

    async printReceipt(payload) {
        const settings = await getSettings();
        document.getElementById('prFirmName').textContent = settings.storeName;
        document.getElementById('prAddress').textContent = settings.address;
        document.getElementById('prContact').textContent = settings.phone ? `Ph: ${settings.phone}` : '';
        document.getElementById('prGstinBlock').style.display = settings.gstin ? 'block' : 'none';
        document.getElementById('prGstin').textContent = settings.gstin || '';
        document.getElementById('prTitle').textContent = payload.type === 'Return' ? 'RETURN / REFUND' : 'INVOICE';
        document.getElementById('prInv').textContent = payload.invoiceNo;
        document.getElementById('prDate').textContent = new Date().toLocaleString('en-IN');
        document.getElementById('prCustomer').textContent = payload.customer;
        document.getElementById('prCustMob').textContent = payload.mobile || '';
        document.getElementById('prPayMode').textContent = payload.paymentMode;
        document.getElementById('prItemsBody').innerHTML = payload.items.map(i => `
            <tr>
                <td>${escapeHtml(i.itemName)}</td>
                <td>${i.quantity}</td>
                <td>${i.rate.toFixed(2)}</td>
                <td>${i.amount.toFixed(2)}</td>
            </tr>
        `).join('');
        document.getElementById('prSubtotal').textContent = payload.subtotal.toFixed(2);
        document.getElementById('prDiscount').textContent = payload.billDiscount.toFixed(2);
        document.getElementById('prRoundoff').textContent = payload.roundOff.toFixed(2);
        document.getElementById('prTotal').textContent = payload.total.toFixed(2);
        document.getElementById('prFooter').textContent = settings.footer;
        window.print();
    }
};

// ---------------- Quick Add (create a new inventory item mid-sale) ----------------
function openQuickAdd() {
    document.getElementById('qBarcode').value = '';
    document.getElementById('qName').value = '';
    document.getElementById('qCategory').value = '';
    document.getElementById('qBrand').value = '';
    document.getElementById('qMrp').value = '';
    document.getElementById('qPrice').value = '';
    document.getElementById('qPurchaseRate').value = '';
    document.getElementById('qQty').value = 0;
    document.getElementById('qMoq').value = 1;
    document.getElementById('qTags').value = '';
    document.getElementById('qImage').value = '';
    openModal('quickAddModal');
}
function generateBarcode() { document.getElementById('qBarcode').value = generateLocalBarcode(); }

async function saveNewItem() {
    const name = document.getElementById('qName').value.trim();
    if (!name) return toast('Item name is required.', 'error');
    let barcode = document.getElementById('qBarcode').value.trim();
    if (!barcode) { generateBarcode(); barcode = document.getElementById('qBarcode').value; }

    const btn = document.getElementById('btn-save-item');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    try {
        if (await isBarcodeTaken(barcode)) {
            throw new Error('That barcode already exists on another item.');
        }
        await addProduct({
            barcode,
            itemname: name,
            category: document.getElementById('qCategory').value.trim(),
            brandname: document.getElementById('qBrand').value.trim(),
            mrp: parseFloat(document.getElementById('qMrp').value) || 0,
            rate: parseFloat(document.getElementById('qPrice').value) || 0,
            purchaseRate: parseFloat(document.getElementById('qPurchaseRate').value) || 0,
            quantity: parseFloat(document.getElementById('qQty').value) || 0,
            moq: parseFloat(document.getElementById('qMoq').value) || 1,
            tags: document.getElementById('qTags').value.trim(),
            image: document.getElementById('qImage').value.trim()
        });
        toast('Item added to inventory.', 'success');
        closeModal('quickAddModal');
    } catch (e) {
        toast('Failed to save item: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '💾 Add to Inventory';
    }
}

// ---------------- Calculator ----------------
const CalculatorApp = {
    isOpen: false, expr: '',
    toggle() { this.isOpen ? this.close() : this.open(); },
    open() {
        const el = document.getElementById('floating-calculator');
        if (!el) return;
        el.style.display = 'block';
        this.isOpen = true;
    },
    close() {
        const el = document.getElementById('floating-calculator');
        if (el) el.style.display = 'none';
        this.isOpen = false;
    },
    press(val) {
        this.expr += val;
        document.getElementById('calc-display').textContent = this.expr;
    },
    clear() { this.expr = ''; document.getElementById('calc-display').textContent = '0'; },
    evaluate() {
        try {
            if (!/^[0-9+\-*/.() ]*$/.test(this.expr)) throw new Error('bad expr');
            // eslint-disable-next-line no-new-func
            const result = Function(`"use strict"; return (${this.expr || 0})`)();
            this.expr = String(result);
            document.getElementById('calc-display').textContent = this.expr;
        } catch {
            document.getElementById('calc-display').textContent = 'Error';
            this.expr = '';
        }
    },
    init() {
        const header = document.getElementById('calc-header');
        const el = document.getElementById('floating-calculator');
        if (!el || !header) return;
        let dragging = false, offX = 0, offY = 0;
        header.addEventListener('mousedown', (e) => {
            dragging = true; offX = e.clientX - el.offsetLeft; offY = e.clientY - el.offsetTop;
        });
        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            el.style.left = (e.clientX - offX) + 'px';
            el.style.top = (e.clientY - offY) + 'px';
        });
        document.addEventListener('mouseup', () => dragging = false);
    }
};

// ---------------- Wire-up ----------------
window.addEventListener('DOMContentLoaded', () => {
    InventoryApp.init();
    CartApp.render();
    CalculatorApp.init();

    document.getElementById('posSearch')?.addEventListener('input', debounce(() => InventoryApp.applyFilters(), 150));
    document.getElementById('posSearch')?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const term = e.target.value.trim();
        if (!term) return;
        const exact = InventoryApp.products.find(p => p.barcode === term);
        if (exact) {
            CartApp.addItem(exact);
            e.target.value = '';
            InventoryApp.applyFilters();
        }
    });
    ['filterCategory', 'filterBrand', 'minPrice', 'maxPrice'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => InventoryApp.applyFilters());
    });
    document.getElementById('billDiscountType')?.addEventListener('change', () => CartApp.render());
    document.getElementById('billDiscountValue')?.addEventListener('input', () => CartApp.render());
    document.getElementById('chkReturnMode')?.addEventListener('change', () => {
        if (CartApp.items.length) toast('Return mode changed — clear the cart to avoid mixing modes.', 'info');
    });

    document.getElementById('btn-hold')?.addEventListener('click', () => CartApp.hold());
    document.getElementById('btn-recall')?.addEventListener('click', () => CartApp.openRecall());
    document.getElementById('btn-clear')?.addEventListener('click', () => {
        if (CartApp.items.length && !confirm('Clear the current bill?')) return;
        CartApp.clear();
    });
    document.getElementById('btn-checkout')?.addEventListener('click', () => CartApp.openPaymentPopup());
    document.getElementById('btn-confirm-payment')?.addEventListener('click', () => CartApp.checkout());
    ['payCash', 'payUPI', 'payCard'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', () => CartApp.calcSplitPay());
    });

    document.getElementById('btn-quick-add')?.addEventListener('click', openQuickAdd);
    document.getElementById('btn-gen-barcode')?.addEventListener('click', generateBarcode);
    document.getElementById('btn-save-item')?.addEventListener('click', saveNewItem);

    document.getElementById('btn-calc-toggle')?.addEventListener('click', () => CalculatorApp.toggle());
    document.getElementById('btn-calc-close')?.addEventListener('click', () => CalculatorApp.close());
    document.getElementById('btn-calc-clear')?.addEventListener('click', () => CalculatorApp.clear());
    document.getElementById('btn-calc-eq')?.addEventListener('click', () => CalculatorApp.evaluate());
    document.querySelectorAll('.calc-key').forEach(k => k.addEventListener('click', () => CalculatorApp.press(k.dataset.val)));

    document.addEventListener('keydown', (e) => {
        const tag = document.activeElement.tagName;
        const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
        if (e.key === 'F4') { e.preventDefault(); CartApp.openPaymentPopup(); }
        if (e.key === 'F9') { e.preventDefault(); CalculatorApp.toggle(); }
        if (e.altKey && e.key.toLowerCase() === 'c') { e.preventDefault(); openQuickAdd(); }
        if (e.altKey && e.key.toLowerCase() === 's') { e.preventDefault(); document.getElementById('posSearch')?.focus(); }
        if (e.key === 'Enter' && !typing) { CartApp.openPaymentPopup(); }
    });
});
