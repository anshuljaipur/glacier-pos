const API = {
    async getInventory() {
        try {
            const res = await fetch(`${CONFIG.API_URL}?action=getInventory`);
            const data = await res.json();
            if (Array.isArray(data)) return data;
            if (data && data.success) return data.products;
            throw new Error(data.message || 'Invalid data format received');
        } catch (error) {
            console.error("Inventory Sync Error:", error);
            throw error;
        }
    },

    async saveSale(payload) {
        try {
            const res = await fetch(CONFIG.API_URL, {
                method: 'POST',
                body: JSON.stringify({ action: 'saveSale', payload: payload })
            });
            const data = await res.json();
            if(data && data.success === false) throw new Error(data.message || 'Failed to save sale');
            return data;
        } catch (error) {
            console.error("Save Sale Error:", error);
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

    async inwardStock(payload) {
        try {
            const res = await fetch(CONFIG.API_URL, {
                method: 'POST',
                body: JSON.stringify({ action: 'inwardStock', payload: payload })
            });
            const data = await res.json();
            if(data && data.success === false) throw new Error(data.message || 'Failed to inward stock');
            return data;
        } catch (error) {
            console.error("Inward Error:", error);
            throw error;
        }
    },

    async getRegisters() {
        try {
            const res = await fetch(`${CONFIG.API_URL}?action=getRegisters`);
            return await res.json();
        } catch (error) {
            console.error("Fetch Registers Error:", error);
            throw error;
        }
    },

    async deleteVoucher(id) {
        try {
            const res = await fetch(CONFIG.API_URL, {
                method: 'POST',
                body: JSON.stringify({ action: 'deleteVoucher', payload: { id: id } })
            });
            return await res.json();
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
