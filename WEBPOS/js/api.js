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
            const res = await fetch(CONFIG.API_URL, {
                method: 'POST',
                body: JSON.stringify({ action: 'saveSale', payload: payload })
            });
            const data = await res.json();
            if(!data.success) throw new Error(data.message);
            return data;
        } catch (error) {
            console.error("Save Sale Error:", error);
            throw error;
        }
    },
    resolveImage(url) {
        if(!url) return 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjNmNGY2Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiM5Y2EzYWYiPk5vIEltYWdlPC90ZXh0Pjwvc3ZnPg==';
        if(url.includes('drive.google.com')) {
            const match = url.match(/id=([^&]+)/) || url.match(/d\/([a-zA-Z0-9-_]+)/);
            if(match) return `https://drive.google.com/uc?id=${match[1]}`;
        }
        return url;
    }
};