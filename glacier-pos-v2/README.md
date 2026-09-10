# Glacier POS v2 — Firebase-only rebuild

Everything (inventory, sales, purchases, purchase orders, settings) now
lives in **Firestore**. There is no Google Sheets / Apps Script bridge
anymore, which removes the entire class of "404 / stale deployment /
invalid JSON" failures you hit with the old system. The product grid
also updates **live** across every device via Firestore's real-time
listeners — no manual "Sync" button.

## 1. One-time Firebase Console setup

You're reusing your existing `glacier-ice-cream-parlor` Firebase project.

1. **Enable Authentication** → Firebase Console → Build → Authentication →
   Get Started → Sign-in method → enable **Email/Password**.
2. **Create your staff login(s)** → Authentication → Users → Add user →
   enter an email + password for each person who should be able to open
   the POS. There is no public self-signup — this is intentional.
3. **Lock down Firestore Security Rules** → Build → Firestore Database →
   Rules → replace with:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if request.auth != null;
       }
     }
   }
   ```

   This is the actual security boundary — the login screen in the app is
   just UX. Without this rule change, anyone with your `firebaseConfig`
   (which is not a secret — it's always visible in the JS) could read or
   write your data directly, logged in or not.

4. No composite indexes are needed — every query in this app is either a
   single `where`, a single `orderBy`, or filtered client-side.

## 2. Migrate your existing inventory

Your product master data currently lives in a Google Sheet. To bring it
into Firestore:

1. Export your Sheet as CSV.
2. Re-save/rename its header row to match: `barcode,itemname,category,brandname,mrp,rate,purchaseRate,quantity,moq,tags,image`
   (Inventory page → **Download CSV Template** shows the exact format.)
3. Go to **Inventory → Import CSV**, choose the file, click Import.

This only *adds* new items — don't run the same file twice, or you'll
get duplicates. It's meant as a one-time migration step; from then on,
add/edit items directly in the Inventory page.

## 3. Deploy

Same as before — this is a static site. Push this folder to your GitHub
Pages repo (or any static host) and open `index.html`. `login.html` is
the entry point for anyone not signed in; every other page redirects
there automatically if there's no active session.

## What changed vs. the old Sheets+AppsScript version

- **No more Apps Script bridge** — Firestore is the only backend, so
  there's no separate deployment URL that can go stale.
- **Real-time sync** — product stock updates live on every screen.
- **Atomic stock + invoice numbers** — checkout uses a single Firestore
  transaction, so two terminals billing at once can't collide on an
  invoice number or race each other on stock quantity (the old
  `Date.now().slice(-6)` invoice numbers could theoretically collide;
  the old stock update wasn't atomic at all).
- **Login required** — see step 1 above. Old app had none.
- **Void instead of hard delete** in Registers — keeps an audit trail
  and reverses stock atomically, rather than silently deleting history.
- **Correct totals saved** — subtotal/discount/round-off/total are all
  persisted on the voucher itself (the old app only saved raw item
  amounts, so any bill-level discount was invisible in Registers/
  reprints — this was a real bug, see prior conversation).
- **New pages**: Dashboard (today's sales, top items, low stock),
  Purchase Orders (draft orders to suppliers, doesn't touch stock),
  Settings (store profile, invoice prefix, receipt footer — previously
  hardcoded in `config.js`).
- **CSV bulk import** for the initial migration.
- **Offline read persistence** — Firestore caches data locally so brief
  network drops don't blank the screen.

## Known limits / things to decide later

- Registers loads the most recent 500 vouchers. Fine for a single store
  for a long while; if you outgrow it, add pagination in `store.js`'s
  `getVouchers()`.
- All logged-in users currently have equal access (no role separation
  between, say, a cashier and an admin). If you need that, it requires
  Firebase custom claims or a `users` collection with a `role` field,
  checked both in the UI and in Firestore Rules.
- The barcode "scanner" support relies on a hardware scanner acting as
  a keyboard and the search box staying focused (it re-focuses after
  every action). Camera-based scanning isn't included.
