const API = {
    async getInventory() {
        try {
            const res = await fetch(`${CONFIG.API_URL}?action=getInventory`);
            const data = await res.json();
            if(!data.success) throw new Error(data.message);
            return data.products;
        } catch (error) {
            console.error("Inventory Sync Error:", error);
            throw error;
        }
    },
    async saveSale(payload) {
        try {
            const targetUrl = `${CONFIG.API_URL}?action=saveSale&data=${encodeURIComponent(JSON.stringify(payload))}`;
            const res = await fetch(targetUrl);
            const data = await res.json();
            if(!data.success) throw new Error(data.message || 'Failed to save sale');
            return data;
        } catch (error) {
            console.error("Save Sale Error:", error);
            throw error;
        }
    },
    resolveImage(url) {
        // 1. Fallback for blank/missing images
        if (!url) return 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjNmNGY2Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiM5Y2EzYWYiPk5vIEltYWdlPC90ZXh0Pjwvc3ZnPg==';
        
        // 2. If it is already a full web URL (like postimg.cc links), leave it alone
        if (url.startsWith('http')) {
            return url;
        }

        // 3. Handle Grocery Images (checks for 'Products_Images/' path)[cite: 2]
        if (url.includes('Products_Images/')) {
            const appName = encodeURIComponent("LiveInventroy-257487838");
            const tableName = encodeURIComponent("Products");
            const safeFileName = url.split('/').map(encodeURIComponent).join('/');
            return `https://www.appsheet.com/template/gettablefileurl?appName=${appName}&tableName=${tableName}&fileName=${safeFileName}`;
        }

        // 4. Handle Ice Cream Images (default AppSheet path)[cite: 2]
        const icAppName = encodeURIComponent("IceCreamInventory-257487838");
        const icTableName = encodeURIComponent("menu");
        // We do not split/join by slash here as per your original ice cream formatting logic
        return `https://www.appsheet.com/template/gettablefileurl?appName=${icAppName}&tableName=${icTableName}&fileName=${url}`;
    }

    async createItem(payload) {
        try {
            const targetUrl = `${CONFIG.API_URL}?action=createItem&data=${encodeURIComponent(JSON.stringify(payload))}`;
            const res = await fetch(targetUrl);
            const data = await res.json();
            if(data && data.success === false) throw new Error(data.message || 'Failed to create item');
            return data;
        } catch (error) {
            console.error("Create Item Error:", error);
            throw error;
        }
    },
};
