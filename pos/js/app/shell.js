import { connectivity } from '../firebase/init.js';
import { onAuthChange, signOut, can } from '../auth/auth.js';

const NAV_ITEMS = [
  { href: 'dashboard.html', label: 'Dashboard', perm: 'view' },
  { href: 'pos.html', label: 'POS Billing', perm: 'view' },
  { href: 'products.html', label: 'Products', perm: 'view' },
  { href: 'inventory.html', label: 'Inventory', perm: 'view' },
  { href: 'purchases.html', label: 'Purchases', perm: 'purchase' },
  { href: 'sales.html', label: 'Sales', perm: 'view' },
  { href: 'returns.html', label: 'Returns', perm: 'view' },
  { href: 'customers.html', label: 'Customers', perm: 'view' },
  { href: 'suppliers.html', label: 'Suppliers', perm: 'view' },
  { href: 'masters.html', label: 'Masters', perm: 'view' },
  { href: 'reports.html', label: 'Reports', perm: 'reports' },
  { href: 'sync.html', label: 'Sync Center', perm: 'sync' },
  { href: 'audit.html', label: 'Audit Log', perm: 'settings' },
  { href: 'settings.html', label: 'Settings', perm: 'settings' }
];

/**
 * Renders the left rail + status banner into #app-shell-root and moves the
 * page's own <main id="page-content"> markup inside it. Every authenticated
 * HTML page calls mountShell() once its DOM is ready.
 */
export function mountShell({ activePage }) {
  const root = document.getElementById('app-shell-root');
  const pageContent = document.getElementById('page-content');
  const currentPath = pageContent ? pageContent.innerHTML : '';

  root.innerHTML = `
    <div class="app-shell">
      <aside class="rail">
        <div class="brand">Counter POS</div>
        <nav id="rail-nav"></nav>
        <div style="flex:1"></div>
        <div style="padding:0 1.25rem;">
          <div id="user-name" class="mono" style="font-size:0.75rem;color:var(--ink-muted);margin-bottom:0.5em;"></div>
          <button id="sign-out-btn" style="width:100%;">Sign out</button>
        </div>
      </aside>
      <div>
        <div id="status-banner" class="status-banner"></div>
        <main class="main">${currentPath}</main>
      </div>
    </div>
  `;

  const nav = document.getElementById('rail-nav');
  nav.innerHTML = NAV_ITEMS.map((item) => `
    <a href="${item.href}" data-perm="${item.perm}" class="${item.href === activePage ? 'active' : ''}">${item.label}</a>
  `).join('');

  connectivity.subscribe((online) => renderStatusBanner(online));

  onAuthChange(({ user, role, profile }) => {
    if (!user) return;
    document.getElementById('user-name').textContent = `${profile?.name || user.email} · ${role || 'no role'}`;
    for (const link of nav.querySelectorAll('a')) {
      const perm = link.dataset.perm;
      link.style.display = can(perm) ? '' : 'none';
    }
  });

  document.getElementById('sign-out-btn').addEventListener('click', async () => {
    await signOut();
    window.location.href = 'index.html';
  });
}

function renderStatusBanner(online) {
  const el = document.getElementById('status-banner');
  if (!el) return;
  el.className = 'status-banner' + (online ? '' : ' offline');
  el.innerHTML = `<span class="dot"></span> ${online ? 'ONLINE' : 'OFFLINE — changes are queued and will sync automatically'}`;
}
