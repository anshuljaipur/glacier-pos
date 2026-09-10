// ============================================================
// Registers page (registers.html) — sales/purchase/return history
// ============================================================
const RegApp = {
    all: [],

    async init() {
        document.getElementById('regFrom').value = todayStr();
        document.getElementById('regTo').value = todayStr();
        await this.load();

        document.getElementById('btn-refresh')?.addEventListener('click', () => this.load());
        ['regFrom', 'regTo', 'regType', 'regSearch'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', () => this.render());
            document.getElementById(id)?.addEventListener('change', () => this.render());
        });
        document.getElementById('btn-export-csv')?.addEventListener('click', () => this.exportCsv());
    },

    async load() {
        const btn = document.getElementById('btn-refresh');
        if (btn) btn.textContent = '⏳…';
        try {
            this.all = await getVouchers();
            this.render();
        } catch (e) {
            document.getElementById('regBody').innerHTML = `<tr><td colspan="7" class="empty-state">Failed to load: ${escapeHtml(e.message)}</td></tr>`;
        } finally {
            if (btn) btn.textContent = '↻ Refresh';
        }
    },

    getFiltered() {
        const from = document.getElementById('regFrom').value;
        const to = document.getElementById('regTo').value;
        const type = document.getElementById('regType').value;
        const search = (document.getElementById('regSearch').value || '').toLowerCase();
        return this.all.filter(v => {
            if (from && v.date < from) return false;
            if (to && v.date > to) return false;
            if (type && v.type !== type) return false;
            if (search && !(v.invoiceNo || '').toLowerCase().includes(search) && !(v.customer || '').toLowerCase().includes(search)) return false;
            return true;
        });
    },

    render() {
        const list = this.getFiltered();
        const body = document.getElementById('regBody');
        if (list.length === 0) {
            body.innerHTML = `<tr><td colspan="7" class="empty-state">No records for this filter.</td></tr>`;
        } else {
            body.innerHTML = list.map(v => `
                <tr style="${v.voided ? 'opacity:0.55;' : ''}">
                    <td>${escapeHtml(v.invoiceNo)}</td>
                    <td>${v.date}</td>
                    <td><span class="pill ${v.type === 'Sale' ? 'sale' : v.type === 'Purchase' ? 'purchase' : 'return'}">${v.type}</span> ${v.voided ? '<span class="pill voided">Voided</span>' : ''}</td>
                    <td>${escapeHtml(v.customer || '-')}</td>
                    <td>${escapeHtml(v.mobile || '-')}</td>
                    <td>${fmtMoney(v.total)}</td>
                    <td>
                        <button class="btn btn-outline btn-sm" onclick="RegApp.print('${v.id}')">Print</button>
                        ${!v.voided ? `<button class="btn btn-danger btn-sm" onclick="RegApp.voidOne('${v.id}')">Void</button>` : ''}
                    </td>
                </tr>`).join('');
        }

        const activeTotal = list.filter(v => !v.voided).reduce((s, v) => s + (v.total || 0), 0);
        document.getElementById('regSummary').textContent = `${list.length} records · ${fmtMoney(activeTotal)} total`;
    },

    async voidOne(id) {
        const v = this.all.find(x => x.id === id);
        if (!v) return;
        if (!confirm(`Void ${v.invoiceNo}? This reverses its stock effect. This cannot be undone.`)) return;
        try {
            await voidVoucher(v);
            toast(`${v.invoiceNo} voided and stock reversed.`, 'success');
            this.load();
        } catch (e) {
            toast('Void failed: ' + e.message, 'error');
        }
    },

    async print(id) {
        const v = this.all.find(x => x.id === id);
        if (!v) return;
        const settings = await getSettings();
        document.getElementById('prFirmName').textContent = settings.storeName;
        document.getElementById('prAddress').textContent = settings.address;
        document.getElementById('prContact').textContent = settings.phone ? `Ph: ${settings.phone}` : '';
        document.getElementById('prGstinBlock').style.display = settings.gstin ? 'block' : 'none';
        document.getElementById('prGstin').textContent = settings.gstin || '';
        document.getElementById('prTitle').textContent = (v.type === 'Return' ? 'RETURN / REFUND' : v.type === 'Purchase' ? 'PURCHASE VOUCHER' : 'INVOICE') + (v.voided ? ' (VOIDED)' : '');
        document.getElementById('prInv').textContent = v.invoiceNo;
        document.getElementById('prDate').textContent = v.date;
        document.getElementById('prCustomer').textContent = v.customer;
        document.getElementById('prCustMob').textContent = v.mobile || v.refNo || '';
        document.getElementById('prPayMode').textContent = v.paymentMode;
        document.getElementById('prItemsBody').innerHTML = v.items.map(i => `
            <tr><td>${escapeHtml(i.itemName)}</td><td>${i.quantity}</td><td>${i.rate.toFixed(2)}</td><td>${i.amount.toFixed(2)}</td></tr>
        `).join('');
        document.getElementById('prSubtotal').textContent = (v.subtotal || 0).toFixed(2);
        document.getElementById('prDiscount').textContent = (v.billDiscount || 0).toFixed(2);
        document.getElementById('prRoundoff').textContent = (v.roundOff || 0).toFixed(2);
        document.getElementById('prTotal').textContent = (v.total || 0).toFixed(2);
        document.getElementById('prFooter').textContent = settings.footer;
        window.print();
    },

    exportCsv() {
        const list = this.getFiltered();
        if (list.length === 0) return toast('Nothing to export.', 'error');
        const rows = [['Invoice', 'Date', 'Type', 'Customer', 'Mobile', 'Payment Mode', 'Total', 'Voided']];
        list.forEach(v => rows.push([v.invoiceNo, v.date, v.type, v.customer, v.mobile || '', v.paymentMode, v.total, v.voided ? 'Yes' : 'No']));
        const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `registers_${todayStr()}.csv`;
        a.click();
    }
};

window.addEventListener('DOMContentLoaded', () => RegApp.init());
