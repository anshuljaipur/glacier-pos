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
        if(!url) return 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjNmNGY2Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiM5Y2EzYWYiPk5vIEltYWdlPC90ZXh0Pjwvc3ZnPg==';
        
        // 2. Safely parse Google Drive URLs
        if(url.includes('drive.google.com')) {
            const match = url.match(/id=([^&]+)/) || url.match(/d\/([a-zA-Z0-9-_]+)/);
            if(match) {
                // Bypasses the new Drive security blocks by using Google's direct image content server
                return `https://lh3.googleusercontent.com/d/${match[1]}`;
            }
        }
        
        // 3. Handle relative image paths (e.g., "Products_Images/...")
        // If these images live on your main website server, you must prefix them with your domain.
        // Uncomment and change the URL below if your images are breaking:
        if(url.startsWith('Products_Images/')) {
            // return `https://www.your-main-website.com/${url}`;
            return url; // Works if the folder is uploaded directly to your GitHub repository
        }

        return url;
    }
};
