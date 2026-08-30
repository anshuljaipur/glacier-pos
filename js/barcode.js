// Barcode Scanner listener
let barcodeBuffer = "";
let barcodeTimeout;

document.addEventListener('keydown', (e) => {
    // Shortcuts
    if(e.key === 'F2') { e.preventDefault(); document.getElementById('pos-search').focus(); return; }
    if(e.key === 'F8') { e.preventDefault(); CartApp.checkout(); return; }
    
    // Ignore if user is manually typing in input fields (except search)
    if(e.target.tagName === 'INPUT' && e.target.id !== 'pos-search') return;

    // Barcode scanner emulation (rapid typing)
    if(e.key.length === 1) {
        barcodeBuffer += e.key;
        clearTimeout(barcodeTimeout);
        barcodeTimeout = setTimeout(() => {
            if(barcodeBuffer.length >= 3) {
                // Find and add product automatically
                const prod = InventoryApp.products.find(p => p.barcode && p.barcode.toString() === barcodeBuffer);
                if(prod) {
                    CartApp.addItem(prod);
                    document.getElementById('pos-search').value = '';
                }
            }
            barcodeBuffer = "";
        }, 50); // Scanner latency threshold
    }
});

// App Initialization
document.getElementById('pos-search').addEventListener('input', () => InventoryApp.search());
document.getElementById('filter-category').addEventListener('change', () => InventoryApp.search());
document.getElementById('filter-brand').addEventListener('change', () => InventoryApp.search());
document.getElementById('global-discount').addEventListener('input', () => CartApp.render());
document.getElementById('amount-received').addEventListener('input', () => CartApp.calculateChange());

window.onload = () => {
    InventoryApp.sync();
    document.getElementById('pos-search').focus();
};