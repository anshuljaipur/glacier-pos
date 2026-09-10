// ============================================================
// Purchase Orders page (purchase_order.html)
// Orders placed with a supplier. These do NOT affect stock —
// only converting to an actual Purchase entry does that.
// ============================================================
const POApp = {
    products: [],
    draftItems: [],
    orders: [],

    init() {
        listenProducts((list) => { this.products = list; });
        listenPurchaseOrders((list) => { this.orders = list; this.renderList(); });
        this.renderDraft();

        document.getElementById('poItemSearch')?.addEventListener('input', debounce(() => this.renderSuggestions(), 150));
        document.getElementById('btn-add-po-item')?.addEventListener('click', () => this.addFromSearch());
        document.getElementById('btn-create-po')?.addEventListener('click', () => this.create());
    },

    renderSuggestions() {
        const term = (document.getElementById('poItemSearch').value || '').toLowerCase();
        const box = document.getElementById('poSuggestions');
        if (!term) { box.innerHTML = ''; return; }
        const matches = this.products.filter(p => (p.itemname || '').toLowerCase().includes(term)).slice(0, 8);
        box.innerHTML = matches.map(p => `<div class="flex-between" style="padding:6px 8px; cursor:pointer; border-bottom:1px solid var(--border);" onclick="POApp.pick('${p.id}')"><span>${escapeHtml(p.itemname)}</span><span class="text-muted">Stock: ${p.quantity || 0}</span></div>`).join('') || `<div class="text-muted" style="padding:6px;">No matches</div>`;
    },
    pick(id) {
        const p = this.products.find(x => x.id === id);
        if (!p) return;
        document.getElementById('poItemSearch').value = p.itemname;
        document.getElementById('poItemSearch').dataset.pickedId = id;
        document.getElementById('poSuggestions').innerHTML = '';
    },
    addFromSearch() {
        const id = document.getElementById('poItemSearch').dataset.pickedId;
        const p = this.products.find(x => x.id === id);
        const qty = parseInt(document.getElementById('poItemQty').value) || 1;
        if (!p) return toast('Pick an item from the suggestions first.', 'error');
        const existing = this.draftItems.find(i => i.barcode === p.barcode);
        if (existing) existing.quantity += qty;
        else this.draftItems.push({ barcode: p.barcode, itemName: p.itemname, quantity: qty });
        document.getElementById('poItemSearch').value = '';
        document.getElementById('poItemSearch').dataset.pickedId = '';
        document.getElementById('poItemQty').value = 1;
        this.renderDraft();
    },
    removeDraft(idx) { this.draftItems.splice(idx, 1); this.renderDraft(); },
    renderDraft() {
        const body = document.getElementById('poDraftBody');
        body.innerHTML = this.draftItems.length === 0
            ? `<div class="empty-state">No items added yet.</div>`
            : this.draftItems.map((i, idx) => `
                <div class="flex-between" style="padding:6px 0; border-bottom:1px solid var(--border);">
                    <span>${escapeHtml(i.itemName)} × ${i.quantity}</span>
                    <button onclick="POApp.removeDraft(${idx})" style="background:none;border:none;color:var(--red);cursor:pointer;">×</button>
                </div>`).join('');
    },

    async create() {
        if (this.draftItems.length === 0) return toast('Add at least one item.', 'error');
        const supplier = document.getElementById('poSupplier').value.trim();
        if (!supplier) return toast('Supplier name is required.', 'error');
        const btn = document.getElementById('btn-create-po');
        btn.disabled = true; btn.textContent = 'Creating…';
        try {
            await addPurchaseOrder({ supplier, notes: document.getElementById('poNotes').value.trim(), items: this.draftItems });
            toast('Purchase order created.', 'success');
            this.draftItems = [];
            this.renderDraft();
            document.getElementById('poSupplier').value = '';
            document.getElementById('poNotes').value = '';
        } catch (e) {
            toast('Failed: ' + e.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Create Purchase Order';
        }
    },

    renderList() {
        const body = document.getElementById('poListBody');
        if (this.orders.length === 0) {
            body.innerHTML = `<tr><td colspan="5" class="empty-state">No purchase orders yet.</td></tr>`;
            return;
        }
        body.innerHTML = this.orders.map(o => `
            <tr>
                <td>${escapeHtml(o.supplier)}</td>
                <td>${o.items.map(i => `${escapeHtml(i.itemName)} ×${i.quantity}`).join(', ')}</td>
                <td>${o.date || '-'}</td>
                <td><span class="pill ${o.status === 'Received' ? 'purchase' : 'sale'}">${o.status}</span></td>
                <td>
                    ${o.status === 'Pending' ? `<button class="btn btn-success btn-sm" onclick="POApp.markReceived('${o.id}')">Mark Received</button>` : ''}
                    <button class="btn btn-danger btn-sm" onclick="POApp.remove('${o.id}')">Delete</button>
                </td>
            </tr>`).join('');
    },
    async markReceived(id) {
        if (!confirm('Mark this order as received? This does NOT update stock — record the actual quantities on the Purchase page.')) return;
        await updatePOStatus(id, 'Received');
        toast('Marked received. Don\u2019t forget to log the actual stock inward on the Purchase page.', 'info');
    },
    async remove(id) {
        if (!confirm('Delete this purchase order?')) return;
        await deletePurchaseOrder(id);
    }
};

window.addEventListener('DOMContentLoaded', () => POApp.init());
