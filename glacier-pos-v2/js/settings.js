// ============================================================
// Settings page (settings.html)
// ============================================================
async function loadSettings() {
    const s = await getSettings();
    document.getElementById('setStoreName').value = s.storeName || '';
    document.getElementById('setAddress').value = s.address || '';
    document.getElementById('setPhone').value = s.phone || '';
    document.getElementById('setGstin').value = s.gstin || '';
    document.getElementById('setInvoicePrefix').value = s.invoicePrefix || 'GLC-';
    document.getElementById('setFooter').value = s.footer || '';
    document.getElementById('setLowStock').value = s.lowStockDefault ?? 5;
}

async function saveSettingsForm() {
    const btn = document.getElementById('btn-save-settings');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        await saveSettings({
            storeName: document.getElementById('setStoreName').value.trim() || 'My Store',
            address: document.getElementById('setAddress').value.trim(),
            phone: document.getElementById('setPhone').value.trim(),
            gstin: document.getElementById('setGstin').value.trim(),
            invoicePrefix: document.getElementById('setInvoicePrefix').value.trim() || 'INV-',
            footer: document.getElementById('setFooter').value.trim(),
            lowStockDefault: parseFloat(document.getElementById('setLowStock').value) || 5
        });
        toast('Settings saved.', 'success');
    } catch (e) {
        toast('Save failed: ' + e.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save Settings';
    }
}

window.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    document.getElementById('btn-save-settings')?.addEventListener('click', saveSettingsForm);
});
