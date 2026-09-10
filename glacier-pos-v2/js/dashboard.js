// ============================================================
// Dashboard page (dashboard.html)
// ============================================================
async function loadDashboard() {
    try {
        const [vouchers, products] = await Promise.all([getVouchers(), new Promise(resolve => {
            const unsub = listenProducts(list => { resolve(list); unsub(); });
        })]);

        const today = todayStr();
        const todaysVouchers = vouchers.filter(v => v.date === today && !v.voided);
        const sales = todaysVouchers.filter(v => v.type === 'Sale');
        const returns = todaysVouchers.filter(v => v.type === 'Return');
        const purchases = todaysVouchers.filter(v => v.type === 'Purchase');

        const salesTotal = sales.reduce((s, v) => s + (v.total || 0), 0);
        const returnsTotal = returns.reduce((s, v) => s + Math.abs(v.total || 0), 0);
        const purchaseTotal = purchases.reduce((s, v) => s + (v.total || 0), 0);

        document.getElementById('statSales').textContent = fmtMoney(salesTotal);
        document.getElementById('statBills').textContent = sales.length;
        document.getElementById('statReturns').textContent = fmtMoney(returnsTotal);
        document.getElementById('statPurchase').textContent = fmtMoney(purchaseTotal);

        // Top items today, by revenue
        const itemTotals = {};
        sales.forEach(v => v.items.forEach(i => {
            itemTotals[i.itemName] = (itemTotals[i.itemName] || 0) + i.amount;
        }));
        const top = Object.entries(itemTotals).sort((a, b) => b[1] - a[1]).slice(0, 8);
        document.getElementById('topItemsBody').innerHTML = top.length
            ? top.map(([name, amt]) => `<tr><td>${escapeHtml(name)}</td><td>${fmtMoney(amt)}</td></tr>`).join('')
            : `<tr><td colspan="2" class="empty-state">No sales yet today.</td></tr>`;

        // Low stock / out of stock
        const low = products.filter(p => {
            const qty = parseFloat(p.quantity) || 0, moq = parseFloat(p.moq) || 0;
            return qty <= 0 || (moq > 0 && qty <= moq);
        }).sort((a, b) => (parseFloat(a.quantity) || 0) - (parseFloat(b.quantity) || 0));
        document.getElementById('lowStockBody').innerHTML = low.length
            ? low.slice(0, 30).map(p => `<tr><td>${escapeHtml(p.itemname)}</td><td>${p.quantity || 0}</td><td>${p.moq || '-'}</td></tr>`).join('')
            : `<tr><td colspan="3" class="empty-state">Everything is well stocked.</td></tr>`;
        document.getElementById('lowStockCount').textContent = low.length;

    } catch (e) {
        toast('Failed to load dashboard: ' + e.message, 'error');
    }
}

window.addEventListener('DOMContentLoaded', loadDashboard);
