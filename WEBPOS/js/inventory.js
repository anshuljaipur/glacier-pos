const InventoryApp = {
    products: [],
    filtered: [],
    
    async sync() {
        const btn = document.querySelector('.btn-sync');
        btn.textContent = "Syncing...";
        try {
            this.products = await API.getInventory();
            localStorage.setItem('glacier_inventory', JSON.stringify(this.products));
            this.updateSyncUI(true);
            this.populateFilters();
            this.render(this.products);
        } catch (err) {
            this.updateSyncUI(false);
            // Fallback to local
            const local = localStorage.getItem('glacier_inventory');
            if(local) {
                this.products = JSON.parse(local);
                this.render(this.products);
            }
        } finally {
            btn.textContent = "↻ SYNC";
        }
    },

    updateSyncUI(success) {
        const status = document.getElementById('network-status');
        status.textContent = success ? "● ONLINE" : "● OFFLINE (Read Only)";
        status.className = `status ${success ? 'online' : 'offline'}`;
        document.getElementById('inventory-count').textContent = `Inventory: ${this.products.length} products`;
        
        if(success) {
            const now = new Date();
            document.getElementById('last-sync').textContent = `Last Sync: ${now.toLocaleTimeString()}`;
        }
    },

    populateFilters() {
        const cats = [...new Set(this.products.map(p => p.category))].filter(Boolean);
        const brands = [...new Set(this.products.map(p => p.brandname))].filter(Boolean);
        
        const catSelect = document.getElementById('filter-category');
        const brandSelect = document.getElementById('filter-brand');
        
        catSelect.innerHTML = '<option value="all">All Categories</option>' + cats.map(c => `<option value="${c}">${c}</option>`).join('');
        brandSelect.innerHTML = '<option value="all">All Brands</option>' + brands.map(b => `<option value="${b}">${b}</option>`).join('');
    },

    render(data) {
        const grid = document.getElementById('product-grid');
        grid.innerHTML = '';
        
        data.forEach(p => {
            const stock = parseFloat(p.quantity) || 0;
            const rate = parseFloat(p.sellingrate) || 0;
            const mrp = parseFloat(p.mrp) || rate;
            
            const card = document.createElement('div');
            card.className = `product-card ${stock <= 0 ? 'out-of-stock' : ''}`;
            card.onclick = () => { if(stock > 0) CartApp.addItem(p); };
            
            let stockClass = stock > 10 ? 'stock-high' : (stock > 0 ? 'stock-low' : 'stock-out');
            let stockText = stock > 0 ? `Stock: ${stock}` : 'OUT OF STOCK';

            card.innerHTML = `
                <img src="${API.resolveImage(p.image)}" class="product-image" loading="lazy" onerror="this.src='${API.resolveImage('')}'">
                <div class="product-title">${p.itemname || 'Unknown Item'}</div>
                <div class="product-brand">${p.brandname || '-'}</div>
                <div class="product-price-row">
                    <span class="selling-rate">₹${rate.toFixed(2)}</span>
                    ${mrp > rate ? `<span class="mrp">₹${mrp.toFixed(2)}</span>` : ''}
                </div>
                <div class="product-stock ${stockClass}">${stockText}</div>
            `;
            grid.appendChild(card);
        });
    },

    search() {
        const query = document.getElementById('pos-search').value.toLowerCase();
        const cat = document.getElementById('filter-category').value;
        const brand = document.getElementById('filter-brand').value;

        this.filtered = this.products.filter(p => {
            const matchSearch = p.itemname.toLowerCase().includes(query) || (p.barcode && p.barcode.toString().toLowerCase().includes(query));
            const matchCat = cat === 'all' || p.category === cat;
            const matchBrand = brand === 'all' || p.brandname === brand;
            return matchSearch && matchCat && matchBrand;
        });
        this.render(this.filtered);
    }
};