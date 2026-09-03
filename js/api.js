// Initialize Firebase using your existing Glacier project credentials
const firebaseConfig = {
    apiKey: "AIzaSyCZJj830ufepvh2fh_ehkPoOki_l3QcCew",
    authDomain: "glacier-ice-cream-parlor.firebaseapp.com",
    projectId: "glacier-ice-cream-parlor",
    storageBucket: "glacier-ice-cream-parlor.firebasestorage.app",
    messagingSenderId: "281867852305",
    appId: "1:281867852305:web:6a35075905bdadb0592fb0"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();

const API = {
    async getInventory() {
        try {
            const res = await fetch(`${CONFIG.API_URL}?action=getInventory`);
            const data = await res.json();
            if (Array.isArray(data)) return data;
            if (data && data.success) return data.products;
            throw new Error(data.message || 'Invalid data format');
        } catch (error) {
            console.error("Inventory Sync Error:", error);
            throw error;
        }
    },

    async saveSale(payload) {
        try {
            payload.date = new Date().toISOString().split('T')[0];
            payload.timestamp = firebase.firestore.FieldValue.serverTimestamp();
            payload.type = 'Sale';
            
            // 1. Instant save to Firebase (takes ~50ms)
            const docRef = await db.collection('pos_vouchers').add(payload);
            
            // 2. Background update to Google Sheets (NO "await" + keepalive)
            fetch(CONFIG.API_URL, {
                method: 'POST',
                redirect: 'follow',
                keepalive: true, // Forces browser to finish this even if print dialog opens
                body: JSON.stringify({ action: 'updateStock', payload: payload })
            }).catch(e => console.error("Background stock sync failed", e));

            // Instantly returns success to UI so print dialog opens immediately
            return { success: true, id: docRef.id };
        } catch (error) {
            console.error("Save Sale Error:", error);
            throw error;
        }
    },

    async savePurchase(payload) {
        try {
            payload.date = new Date().toISOString().split('T')[0];
            payload.timestamp = firebase.firestore.FieldValue.serverTimestamp();
            payload.type = 'Purchase';
            
            const docRef = await db.collection('pos_vouchers').add(payload);

            // Background update to Google Sheets (NO "await" + keepalive)
            fetch(CONFIG.API_URL, {
                method: 'POST',
                redirect: 'follow',
                keepalive: true, 
                body: JSON.stringify({ action: 'updateStockInward', payload: payload })
            }).catch(e => console.error("Background stock sync failed", e));

            return { success: true, id: docRef.id };
        } catch (error) {
            console.error("Save Purchase Error:", error);
            throw error;
        }
    },

    async createItem(payload) {
        try {
            const res = await fetch(CONFIG.API_URL, {
                method: 'POST',
                body: JSON.stringify({ action: 'createItem', payload: payload })
            });
            const data = await res.json();
            if(data && data.success === false) throw new Error(data.message || 'Failed to create item');
            return data;
        } catch (error) {
            console.error("Create Item Error:", error);
            throw error;
        }
    },

    async getRegisters() {
        try {
            const snapshot = await db.collection('pos_vouchers').orderBy('timestamp', 'desc').get();
            let registers = [];
            snapshot.forEach(doc => {
                let data = doc.data();
                registers.push({
                    firebaseId: doc.id,
                    id: data.invoiceNo,
                    date: data.date,
                    type: data.type,
                    party: data.customer,
                    mode: data.paymentMode,
                    total: data.items.reduce((sum, item) => sum + (item.amount || 0), 0),
                    items: data.items
                });
            });
            return registers;
        } catch (error) {
            console.error("Fetch Registers Error:", error);
            throw error;
        }
    },

   async deleteVoucher(voucher) {
        try {
            // 1. Delete the invoice from Firebase instantly
            await db.collection('pos_vouchers').doc(voucher.firebaseId).delete();
            
            // 2. Determine reversal math: 
            // Deleting a Purchase means deducting stock (-1). Deleting a Sale means adding stock (+1).
            const reversalAction = voucher.type === 'Purchase' ? 'updateStock' : 'updateStockInward';
            
            // 3. Strip price data so reversing a Sale doesn't accidentally overwrite your Purchase Rates
            const safeItems = voucher.items.map(i => ({ 
                barcode: i.barcode, 
                itemName: i.itemName || i.itemname, 
                quantity: i.quantity || i.qty 
            }));

            // 4. Send background reversal to Google Sheets
            fetch(CONFIG.API_URL, {
                method: 'POST',
                redirect: 'follow',
                keepalive: true,
                body: JSON.stringify({ 
                    action: reversalAction, 
                    payload: { items: safeItems } 
                })
            }).catch(e => console.error("Background stock reversal failed", e));

            return { success: true };
        } catch (error) {
            console.error("Delete Voucher Error:", error);
            throw error;
        }
    },

    resolveImage(url) {
        if (!url) return 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjNmNGY2Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiM5Y2EzYWYiPk5vIEltYWdlPC90ZXh0Pjwvc3ZnPg==';
        if (url.startsWith('http')) return url;
        if (url.includes('Products_Images/')) {
            const appName = encodeURIComponent("LiveInventroy-257487838");
            const tableName = encodeURIComponent("Products");
            const safeFileName = url.split('/').map(encodeURIComponent).join('/');
            return `https://www.appsheet.com/template/gettablefileurl?appName=${appName}&tableName=${tableName}&fileName=${safeFileName}`;
        }
        const icAppName = encodeURIComponent("IceCreamInventory-257487838");
        const icTableName = encodeURIComponent("menu");
        return `https://www.appsheet.com/template/gettablefileurl?appName=${icAppName}&tableName=${icTableName}&fileName=${url}`;
    }
};
