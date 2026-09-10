// ============================================================
// Inventory management page (inventory.html)
// ============================================================
const InvManager = {
    products: [],
    editingId: null,

    init() {
        listenProducts(
            (list) => { this.products = list; this.render(); },
            () => toast('Lost connection to inventory.', 'error')
        );
        document.getElementById('invSearch')?.addEventListener('input', debounce(() => this.render(), 150));
        document.getElementById('invFilter')?.addEventListener('change', () => this.render());
        document.getElementById('btn-add-product')?.addEventListener('click', () => this.openForm());
        document.getElementById('btn-save-product')?.addEventListener('click', () => this.save());
        document.getElementById('btn-gen-barcode-inv')?.addEventListener('click', () => {
            document.getElementById('pBarcode').value = generateLocalBarcode();
        });
        document.getElementById('btn-import-csv')?.addEventListener('click', () => openModal('importModal'));
        document.getElementById('btn-download-template')?.addEventListener('click', this.downloadTemplate);
        document.getElementById('btn-run-import')?.addEventListener('click', () => this.runImport());
    },

    downloadTemplate() {
        const csv = "barcode,itemname,category,brandname,mrp,rate,purchaseRate,quantity,moq,tags,image\n1234567890123,Sample Item,Beverage,Bisleri,20,18,15,60,5,Vegan,https://example.com/img.jpg\n";
        const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'inventory_template.csv';
        a.click();
    },

    parseCsvLine(line) {
        const out = []; let cur = '', inQ = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQ) {
                if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
                else if (ch === '"') { inQ = false; }
                else cur += ch;
            } else if (ch === '"') { inQ = true; }
            else if (ch === ',') { out.push(cur); cur = ''; }
            else cur += ch;
        }
        out.push(cur);
        return out;
    },

    async runImport() {
        const fileInput = document.getElementById('csvFile');
        const resultBox = document.getElementById('importResult');
        const file = fileInput.files[0];
        if (!file) return toast('Choose a CSV file first.', 'error');

        const text = await file.text();
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) return toast('CSV has no data rows.', 'error');
        const headers = this.parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
        const rows = lines.slice(1).map(line => {
            const cells = this.parseCsvLine(line);
            const obj = {};
            headers.forEach((h, idx) => obj[h] = (cells[idx] || '').trim());
            return obj;
        });

        resultBox.textContent = `Importing ${rows.length} rows…`;
        let success = 0, skipped = 0;
        for (let i = 0; i < rows.length; i += 400) { // Firestore batch limit is 500 writes
            const chunk = rows.slice(i, i + 400);
            const batch = db.batch();
            chunk.forEach(r => {
                if (!r.barcode || !r.itemname) { skipped++; return; }
                const ref = db.collection('products').doc();
                batch.set(ref, {
                    barcode: r.barcode, itemname: r.itemname,
                    category: r.category || '', brandname: r.brandname || '',
                    mrp: parseFloat(r.mrp) || 0, rate: parseFloat(r.rate) || 0,
                    purchaseRate: parseFloat(r.purchaserate) || 0,
                    quantity: parseFloat(r.quantity) || 0, moq: parseFloat(r.moq) || 1,
                    tags: r.tags || '', image: r.image || '', active: true,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                success++;
            });
            await batch.commit();
        }
        resultBox.textContent = `Done — ${success} items imported, ${skipped} rows skipped (missing barcode/name).`;
        toast(`Imported ${success} items.`, 'success');
        fileInput.value = '';
    },

    render() {
        const search = (document.getElementById('invSearch')?.value || '').toLowerCase();
        const filter = document.getElementById('invFilter')?.value || '';
        let list = this.products.filter(p =>
            (p.itemname || '').toLowerCase().includes(search) || (p.barcode || '').includes(search)
        );
        if (filter === 'low') list = list.filter(p => {
            const qty = parseFloat(p.quantity) || 0, moq = parseFloat(p.moq) || 0;
            return qty > 0 && moq > 0 && qty <= moq;
        });
        if (filter === 'oos') list = list.filter(p => (parseFloat(p.quantity) || 0) <= 0);

        document.getElementById('invCount').textContent = `${list.length} items`;
        const body = document.getElementById('invTableBody');
        if (list.length === 0) {
            body.innerHTML = `<tr><td colspan="8" class="empty-state">No items found.</td></tr>`;
            return;
        }
        body.innerHTML = list.map(p => {
            const qty = parseFloat(p.quantity) || 0;
            const moq = parseFloat(p.moq) || 0;
            const stockLabel = qty <= 0 ? `<span class="badge oos" style="position:static;">OOS</span>`
                : (moq > 0 && qty <= moq) ? `<span class="badge low" style="position:static;">${qty}</span>`
                : qty;
            return `
            <tr>
                <td>${escapeHtml(p.itemname)}</td>
                <td>${escapeHtml(p.barcode)}</td>
                <td>${escapeHtml(p.category || '-')}</td>
                <td>${fmtMoney(p.mrp)}</td>
                <td>${fmtMoney(p.rate)}</td>
                <td>${stockLabel}</td>
                <td>${escapeHtml(p.brandname || '-')}</td>
                <td>
                    <button class="btn btn-outline btn-sm" onclick="InvManager.openForm('${p.id}')">Edit</button>
                    <button class="btn btn-danger btn-sm" onclick="InvManager.remove('${p.id}')">Delete</button>
                </td>
            </tr>`;
        }).join('');
    },

    openForm(id = null) {
        this.editingId = id;
        const p = id ? this.products.find(x => x.id === id) : null;
        document.getElementById('productFormTitle').textContent = id ? 'Edit Item' : 'Add Item';
        document.getElementById('pBarcode').value = p?.barcode || '';
        document.getElementById('pName').value = p?.itemname || '';
        document.getElementById('pCategory').value = p?.category || '';
        document.getElementById('pBrand').value = p?.brandname || '';
        document.getElementById('pMrp').value = p?.mrp ?? '';
        document.getElementById('pRate').value = p?.rate ?? '';
        document.getElementById('pPurchaseRate').value = p?.purchaseRate ?? '';
        document.getElementById('pQty').value = p?.quantity ?? 0;
        document.getElementById('pMoq').value = p?.moq ?? 1;
        document.getElementById('pTags').value = p?.tags || '';
        document.getElementById('pImage').value = p?.image || '';
        document.getElementById('pExpiry').value = p?.expiryDate || '';
        openModal('productFormModal');
    },

    async save() {
        const name = document.getElementById('pName').value.trim();
        const barcode = document.getElementById('pBarcode').value.trim();
        if (!name) return toast('Item name is required.', 'error');
        if (!barcode) return toast('Barcode is required.', 'error');

        const btn = document.getElementById('btn-save-product');
        btn.disabled = true; btn.textContent = 'Saving…';

        try {
            if (await isBarcodeTaken(barcode, this.editingId)) {
                throw new Error('That barcode is already used by another item.');
            }
            const data = {
                barcode,
                itemname: name,
                category: document.getElementById('pCategory').value.trim(),
                brandname: document.getElementById('pBrand').value.trim(),
                mrp: parseFloat(document.getElementById('pMrp').value) || 0,
                rate: parseFloat(document.getElementById('pRate').value) || 0,
                purchaseRate: parseFloat(document.getElementById('pPurchaseRate').value) || 0,
                quantity: parseFloat(document.getElementById('pQty').value) || 0,
                moq: parseFloat(document.getElementById('pMoq').value) || 1,
                tags: document.getElementById('pTags').value.trim(),
                image: document.getElementById('pImage').value.trim(),
                expiryDate: document.getElementById('pExpiry').value || ''
            };
            if (this.editingId) {
                await updateProduct(this.editingId, data);
                toast('Item updated.', 'success');
            } else {
                await addProduct(data);
                toast('Item added.', 'success');
            }
            closeModal('productFormModal');
        } catch (e) {
            toast('Save failed: ' + e.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Save Item';
        }
    },

    async remove(id) {
        const p = this.products.find(x => x.id === id);
        if (!confirm(`Delete "${p?.itemname}"? This cannot be undone. Past invoices referencing it are unaffected.`)) return;
        try {
            await deleteProduct(id);
            toast('Item deleted.', 'success');
        } catch (e) {
            toast('Delete failed: ' + e.message, 'error');
        }
    }
};

window.addEventListener('DOMContentLoaded', () => InvManager.init());
