// ============================================================
// Purchase entry page (purchase.html) — adds stock IN via the
// same saveVoucherAndAdjustStock transaction used for sales.
// ============================================================
const PurchaseInv = { products: [] };
const PCart = {
    items: [],
    isSaving: false,

    addItem(product, qty = 1) {
        const existing = this.items.find(i => i.barcode === product.barcode);
        if (existing) existing.qty += qty;
        else this.items.push({ barcode: product.barcode, itemName: product.itemname, rate: parseFloat(product.purchaseRate) || parseFloat(product.rate) || 0, qty, discountPerc: 0 });
        this.render();
    },
    removeItem(idx) { this.items.splice(idx, 1); this.render(); },
    clear() {
        this.items = [];
        document.getElementById('posSupplier').value = '';
        document.getElementById('posRefNo').value = '';
        document.getElementById('billDiscountValue').value = 0;
        this.render();
    },
    setField(idx, field, value) {
        const num = parseFloat(value);
        this.items[idx][field] = isNaN(num) ? 0 : num;
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
        if (this.items.length === 0) {
            body.innerHTML = `<div class="empty-state">No items added yet.</div>`;
        } else {
            body.innerHTML = this.items.map((i, idx) => `
                <div class="cart-item">
                    <div class="cart-name" title="${escapeHtml(i.itemName)}">${escapeHtml(i.itemName)}</div>
                    <input type="number" value="${i.qty}" step="1" onchange="PCart.setField(${idx}, 'qty', this.value)">
                    <input type="number" value="${i.rate}" step="0.01" onchange="PCart.setField(${idx}, 'rate', this.value)">
                    <input type="number" value="${i.discountPerc}" step="1" onchange="PCart.setField(${idx}, 'discountPerc', this.value)">
                    <div>${fmtMoney((i.rate * i.qty) - (i.qty * i.rate * i.discountPerc / 100))}</div>
                    <button onclick="PCart.removeItem(${idx})" style="background:none;border:none;color:var(--red);cursor:pointer;font-weight:800;">×</button>
                </div>`).join('');
        }
        const totals = this.computeTotals();
        document.getElementById('cartCount').textContent = `${this.items.reduce((s, i) => s + i.qty, 0)} Qty (${this.items.length} types)`;
        document.getElementById('cartSubtotal').textContent = fmtMoney(totals.subtotal);
        document.getElementById('cartRoundOff').textContent = totals.roundOff.toFixed(2);
        document.getElementById('cartGrandTotal').textContent = fmtMoney(totals.total);
    },

    async save() {
        if (this.isSaving) return;
        if (this.items.length === 0) return toast('Add at least one item.', 'error');
        this.isSaving = true;
        const btn = document.getElementById('btn-save-purchase');
        btn.disabled = true; btn.textContent = 'Saving…';

        try {
            const totals = this.computeTotals();
            const payload = {
                type: 'Purchase',
                customer: document.getElementById('posSupplier').value || 'Supplier',
                refNo: document.getElementById('posRefNo').value || '',
                paymentMode: document.getElementById('posPayMode').value || 'Account',
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
            toast(`Purchase saved as ${result.invoiceNo}. Stock updated.`, 'success');
            this.clear();
        } catch (e) {
            console.error(e);
            toast('Save failed: ' + e.message, 'error');
        } finally {
            this.isSaving = false;
            btn.disabled = false; btn.textContent = '✔ Save Purchase & Update Stock';
        }
    }
};

function renderPurchaseGrid() {
    const search = (document.getElementById('posSearch')?.value || '').toLowerCase();
    const grid = document.getElementById('productGrid');
    const list = PurchaseInv.products.filter(p => (p.itemname || '').toLowerCase().includes(search) || (p.barcode || '').includes(search)).slice(0, 60);
    grid.innerHTML = list.map(p => `
        <button class="product-card" data-id="${p.id}">
            <img src="${p.image || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjNmNGY2Ii8+PC9zdmc+'}" loading="lazy">
            <div class="pname">${escapeHtml(p.itemname)}</div>
            <div class="text-muted" style="font-size:11px;">Stock: ${p.quantity || 0}</div>
        </button>`).join('');
    grid.querySelectorAll('.product-card').forEach(card => {
        card.addEventListener('click', () => {
            const p = PurchaseInv.products.find(x => x.id === card.dataset.id);
            if (p) PCart.addItem(p);
        });
    });
}

window.addEventListener('DOMContentLoaded', () => {
    listenProducts((list) => { PurchaseInv.products = list; renderPurchaseGrid(); });
    PCart.render();

    document.getElementById('posSearch')?.addEventListener('input', debounce(renderPurchaseGrid, 150));
    document.getElementById('posSearch')?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const term = e.target.value.trim();
        const exact = PurchaseInv.products.find(p => p.barcode === term);
        if (exact) { PCart.addItem(exact); e.target.value = ''; renderPurchaseGrid(); }
    });
    document.getElementById('billDiscountType')?.addEventListener('change', () => PCart.render());
    document.getElementById('billDiscountValue')?.addEventListener('input', () => PCart.render());
    document.getElementById('btn-clear')?.addEventListener('click', () => {
        if (PCart.items.length && !confirm('Clear this purchase entry?')) return;
        PCart.clear();
    });
    document.getElementById('btn-save-purchase')?.addEventListener('click', () => PCart.save());
});
