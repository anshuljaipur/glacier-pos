// Barcode Scanner listener state
if (typeof window.barcodeInitialized === 'undefined') {
    window.barcodeInitialized = true;
    let scanBuffer = "";
    let scanTimeout;

    document.addEventListener('keydown', (e) => {
        if(e.key === 'F2') { e.preventDefault(); document.getElementById('pos-search').focus(); return; }
        if(e.key === 'F8') { e.preventDefault(); CartApp.checkout(); return; }
        
        if(e.target.tagName === 'INPUT' && e.target.id !== 'pos-search') return;

        if(e.key.length === 1) {
            scanBuffer += e.key;
            clearTimeout(scanTimeout);
            scanTimeout = setTimeout(() => {
                if(scanBuffer.length >= 3) {
                    const prod = InventoryApp.products.find(p => p.barcode && p.barcode.toString().trim() === scanBuffer.trim());
                    if(prod) {
                        CartApp.addItem(prod);
                        document.getElementById('pos-search').value = '';
                    }
                }
                scanBuffer = "";
            }, 50);
        }
    });
}

// Event Listeners Initialization
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('pos-search');
    const catFilter = document.getElementById('filter-category');
    const brandFilter = document.getElementById('filter-brand');
    const globalDisc = document.getElementById('global-discount');
    const amtReceived = document.getElementById('amount-received');

    if(searchInput) searchInput.addEventListener('input', () => InventoryApp.search());
    if(catFilter) catFilter.addEventListener('change', () => InventoryApp.search());
    if(brandFilter) brandFilter.addEventListener('change', () => InventoryApp.search());
    if(globalDisc) globalDisc.addEventListener('input', () => CartApp.render());
    if(amtReceived) amtReceived.addEventListener('input', () => CartApp.calculateChange());

    InventoryApp.sync();
    if(searchInput) searchInput.focus();
});