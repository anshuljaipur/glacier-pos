const CartApp = {
    items: [],
    
    addItem(product) {
        const existing = this.items.find(i => i.barcode === product.barcode);
        const maxStock = parseFloat(product.quantity);
        
        if (existing) {
            if(existing.qty + 1 > maxStock) return alert('Insufficient stock!');
            existing.qty++;
        } else {
            if(1 > maxStock) return alert('Insufficient stock!');
            this.items.push({
                barcode: product.barcode,
                itemName: product.itemname,
                rate: parseFloat(product.sellingrate),
                qty: 1,
                gst: parseFloat(product['gst%'] || 0),
                discount: 0
            });
        }
        this.render();
    },

    updateQty(index, change) {
        const item = this.items[index];
        const product = InventoryApp.products.find(p => p.barcode === item.barcode);
        
        if (item.qty + change > parseFloat(product.quantity)) return alert('Insufficient stock!');
        if (item.qty + change <= 0) {
            this.items.splice(index, 1);
        } else {
            item.qty += change;
        }
        this.render();
    },

    clearCart() {
        this.items = [];
        document.getElementById('global-discount').value = 0;
        document.getElementById('amount-received').value = '';
        this.render();
    },

    render() {
        const container = document.getElementById('cart-items-container');
        container.innerHTML = '';
        
        let subtotal = 0;
        let totalGst = 0;

        this.items.forEach((item, index) => {
            const itemTotal = (item.rate * item.qty) - item.discount;
            subtotal += itemTotal;
            totalGst += itemTotal * (item.gst / 100);

            container.innerHTML += `
                <div class="cart-item">
                    <div class="cart-item-details">
                        <div class="cart-item-title">${item.itemName}</div>
                        <div style="font-size: 0.8rem; color: var(--text-muted)">₹${item.rate.toFixed(2)} x ${item.qty}</div>
                        <div class="cart-item-controls">
                            <button class="qty-btn" onclick="CartApp.updateQty(${index}, -1)">-</button>
                            <span style="font-weight: bold; margin: 0 0.5rem">${item.qty}</span>
                            <button class="qty-btn" onclick="CartApp.updateQty(${index}, 1)">+</button>
                        </div>
                    </div>
                    <div class="cart-item-total">₹${itemTotal.toFixed(2)}</div>
                </div>
            `;
        });

        const globalDiscount = parseFloat(document.getElementById('global-discount').value) || 0;
        let total = subtotal + totalGst - globalDiscount;
        let roundOff = 0;
        
        if(CONFIG.ROUND_OFF) {
            const roundedTotal = Math.round(total);
            roundOff = roundedTotal - total;
            total = roundedTotal;
        }

        document.getElementById('cart-count').textContent = `${this.items.reduce((a,b)=>a+b.qty, 0)} ITEMS`;
        document.getElementById('summary-subtotal').textContent = `₹${subtotal.toFixed(2)}`;
        document.getElementById('summary-gst').textContent = `₹${totalGst.toFixed(2)}`;
        document.getElementById('summary-roundoff').textContent = `₹${roundOff.toFixed(2)}`;
        document.getElementById('summary-total').textContent = `₹${Math.max(0, total).toFixed(2)}`;
        
        this.calculateChange();
    },

    calculateChange() {
        const total = parseFloat(document.getElementById('summary-total').textContent.replace('₹', ''));
        const received = parseFloat(document.getElementById('amount-received').value) || 0;
        const change = received - total;
        document.getElementById('change-amount').textContent = `₹${Math.max(0, change).toFixed(2)}`;
    },

    async checkout() {
        if(this.items.length === 0) return alert('Cart is empty!');
        const btn = document.getElementById('btn-pay');
        btn.textContent = 'Processing...';
        btn.disabled = true;

        const payload = {
            invoiceNo: CONFIG.INVOICE_PREFIX + Date.now().toString().slice(-6),
            items: this.items.map(i => ({
                barcode: i.barcode,
                itemName: i.itemName,
                quantity: i.qty,
                rate: i.rate,
                discount: i.discount,
                gst: i.rate * i.qty * (i.gst / 100),
                amount: (i.rate * i.qty) - i.discount
            })),
            paymentMode: document.getElementById('payment-mode').value
        };

        try {
            const res = await API.saveSale(payload);
            this.printReceipt(payload);
            this.clearCart();
            InventoryApp.sync(); // Refresh stock
        } catch (error) {
            alert('Checkout failed: ' + error.message);
        } finally {
            btn.textContent = 'PAY & PRINT (F8)';
            btn.disabled = false;
            document.getElementById('pos-search').focus();
        }
    },

    printReceipt(payload) {
        const printArea = document.getElementById('print-area');
        let itemsHtml = payload.items.map(i => `
            <tr>
                <td colspan="4">${i.itemName}</td>
            </tr>
            <tr>
                <td>${i.quantity}</td>
                <td>x ${i.rate.toFixed(2)}</td>
                <td class="text-right">${i.amount.toFixed(2)}</td>
            </tr>
        `).join('');

        const total = parseFloat(document.getElementById('summary-total').textContent.replace('₹',''));

        printArea.innerHTML = `
            <div class="receipt-header">
                <h2>${CONFIG.STORE_NAME}</h2>
                <div>${CONFIG.STORE_ADDRESS}</div>
                <div>Ph: ${CONFIG.STORE_PHONE}</div>
            </div>
            <div class="receipt-info">
                <div>Inv: ${payload.invoiceNo}</div>
                <div>Date: ${new Date().toLocaleString()}</div>
                <div>Mode: ${payload.paymentMode}</div>
            </div>
            <table class="receipt-table">
                <thead><tr><th>Qty</th><th>Rate</th><th class="text-right">Amt</th></tr></thead>
                <tbody>${itemsHtml}</tbody>
            </table>
            <div class="receipt-totals">
                <div><span>Total Items:</span><span>${payload.items.length}</span></div>
                <div class="grand-total"><span>Total:</span><span>₹${total.toFixed(2)}</span></div>
            </div>
            <div class="receipt-footer">Thank you for visiting!</div>
        `;
        window.print();
    }
};