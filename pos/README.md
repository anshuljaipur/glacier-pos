# Retail POS + Inventory Management System

A production-grade POS where **Firebase is the single source of truth** and
**Google Sheets is a bulk-editing interface for master/inventory data only**.
Sheets never holds transactions. A controlled, loop-safe, two-way sync engine
keeps the two in agreement, with conflict detection, an audit trail, and a
schema that admins can extend without touching code.

This document is the output of the required "first task" (analysis before
code): architecture, Firestore model, Sheet schema, sync design, dynamic
field design, folder structure, security notes, and the decisions made where
the brief left something open.

---

## 1. Architecture

```
GOOGLE SHEETS (Apps Script Web App = API layer)
        ↕  HTTPS (signed requests, no shared secrets in the Sheet)
CLOUD FUNCTIONS (Node.js) — Sync Engine, runs server-side only
        ↕  Admin SDK
CLOUD FIRESTORE — central DB (master + transactional data)
        ↕  Client SDK (Auth + security rules enforced)
POS FRONTEND (static HTML/CSS/JS, deployable on GitHub Pages)
```

Key rule: **the browser never talks to Google Sheets or holds a Sheets/
service-account credential.** All Sheet I/O goes through Apps Script (which
owns the Sheet) calling into a Cloud Function endpoint, and the Cloud
Function is the only thing holding the Firebase Admin credential. The POS
frontend only ever talks to Firestore directly (via Auth + security rules)
or to a `sync` Cloud Function to trigger/preview a sync.

## 2. Decisions made where the brief left a choice open

| Open question | Decision | Why |
|---|---|---|
| Where does sync logic run? | Cloud Functions (Node.js), triggered by an Apps Script time-driven trigger *or* a button in both the Sheet and the POS Sync Center | Keeps Admin SDK credentials off the frontend and off the Sheet |
| How does Apps Script authenticate to the Function? | Function requires a Firebase custom token / ID token minted for a dedicated `sync-service` account, checked against a `roles.sync` custom claim | Avoids embedding a long-lived secret in Apps Script properties beyond one rotate-able token |
| Change detection | Per-record `syncVersion` (int) + `contentHash` (SHA-256 of the synced field set) + `lastModifiedSource` | Cheap, deterministic, avoids expensive full diff, breaks sync loops |
| Product ID format | `PROD-` + zero-padded incrementing counter, allocated via a Firestore transaction on a `counters/products` doc | Human-readable, permanent, race-safe |
| Stock as two-way field | Sync writes stock changes only as **Stock Adjustment ledger entries**, never a raw overwrite | Required by spec section 14/15; preserves ledger integrity |
| Multi-tenancy | `storeId` field stamped on every document now, hardcoded to one value today | Section 66 requires this be retrofit-free later |

## 3. Firestore Data Model

Collections (all documents carry `storeId` for future multi-store):

```
products/{productId}
  productId, barcode, alternateBarcodes[], itemName, variant, brand (ref id),
  category (ref id), subCategory (ref id), unit (ref id),
  purchasePrice, sellingPrice, mrp, gstPercent, hsn, imageUrl, tags[],
  currentStock, minStock, maxStock, reorderLevel,
  expiryDate, batchNumber, supplierId, status: active|inactive|archived,
  customFields: { <fieldKey>: <value>, ... },   // dynamic fields live here
  createdAt, updatedAt, createdBy, updatedBy,
  sync: {
    sheetRowId, lastSheetModifiedAt, lastFirebaseModifiedAt, lastSyncedAt,
    lastModifiedSource: GOOGLE_SHEET|POS|SYSTEM, syncVersion, contentHash,
    syncStatus: synced|pending|conflict|error, syncError
  }

customFieldDefs/{fieldKey}
  fieldName, fieldType, required, defaultValue,
  visibleInPos, visibleInInventory, visibleInSearch, visibleInReports,
  editableFromSheet, editableFromPos, sortOrder, active,
  createdAt, updatedAt          // never physically deleted if data exists

categories/{id}, subCategories/{id}, brands/{id}, units/{id}, taxes/{id}, hsn/{id}
customers/{id}, suppliers/{id}, paymentModes/{id}, users/{id}, roles/{id}

sales/{saleId}
  invoiceNumber, dateTime, customerId, userId, items:[{...snapshot}],
  subtotal, discount, tax, grandTotal, paymentDetails[], status
saleItems are embedded snapshots inside sales.items (never re-derived
from current product master — section 57)

purchases/{id}, purchaseItems embedded, purchaseReturns/{id}, salesReturns/{id}

stockLedger/{entryId}
  dateTime, productId, type: OPENING|SALE|PURCHASE|SALES_RETURN|
  PURCHASE_RETURN|DAMAGE|EXPIRED|LOST|MANUAL_ADJUSTMENT|STOCK_CORRECTION|
  STOCK_TRANSFER|FREE_SAMPLE|OTHER,
  referenceId, quantityChange, previousStock, newStock, source, userId, remarks

expenses/{id}, payments/{id}, settings/{id}

customFields/{fieldKey}  -> alias of customFieldDefs (see section 6)

syncMetadata/{productId}   // fast-lookup mirror of products.sync, indexed
syncLogs/{syncId}
  dateTime, direction, productsAdded, productsUpdated, stockAdjustments,
  productsArchived, conflicts, errors[], userId
auditLogs/{id}
  dateTime, userId, action, module, recordId, field, oldValue, newValue,
  source, device
counters/{name}   // atomic ID allocation, e.g. counters/products.next
```

Design notes:
- **Master vs transaction is enforced structurally**: only `products`,
  `categories`, `brands`, `subCategories`, `units`, `customers`, `suppliers`
  are ever touched by the Sheet sync. `sales`, `purchases`, `payments`,
  `auditLogs` are Firebase-only per section 59.
- Category/Brand/Unit are stored as **IDs** on `products`, never free text —
  section 25.
- `customFields` is a map so the Product doc schema never changes shape when
  an admin adds a field — the field *definition* lives in `customFieldDefs`.

## 4. Google Sheet Schema

One spreadsheet, multiple tabs (section 73). Header row is the contract —
**sync reads by header name, never column position** (section 41).

**`Inventory` tab** (system-controlled columns are protected/locked in Sheets):
```
Product ID | Barcode | Alternate Barcodes | Item Name | Variant | Brand |
Category | Sub Category | Unit | Purchase Price | Selling Price | MRP |
GST % | HSN/SAC | Image URL | Tags | Current Stock | Minimum Stock |
Maximum Stock | Reorder Level | Expiry Date | Batch Number | Supplier |
Status | Created Date* | Updated Date* | Sync Version* | Last Sync* |
Firebase ID*                                   (* = system-controlled)
```
Any additional column (e.g. `Flavour`) that isn't a known header triggers
**"NEW COLUMN DETECTED"** in the POS Sync Center (section 41) rather than a
crash — it is queued for the admin to map to a new `customFieldDefs` entry
or ignore.

Other tabs: `Categories`, `Brands`, `Subcategories`, `Units`, `Suppliers`,
`Customers`, `Settings`, `Sync Status`, `Sync Log` — mirrors of their
Firestore collections, each with the same "system column" protection
pattern and each configurable on/off from POS Settings (section 73).

## 5. Sync Engine Design

**Identity**: `Product ID` is the only durable key (section 40). A Sheet row
with no Product ID is treated as new; Apps Script calls the allocator before
writing it back.

**Change detection** (section 64): every synced entity carries
`syncVersion`, `lastModifiedSource`, and a `contentHash` of its synced
fields. On each sync:
1. Cloud Function pulls the full Sheet via Apps Script's `getChangedInventory`
   (Sheet computes its own row hashes so we don't re-hash 4,000 rows we
   didn't touch).
2. For each row: compare `contentHash` to Firestore's stored hash.
   - Hash differs **and** `lastModifiedSource` on the Firestore side is
     older than `lastSyncedAt` → clean Sheet-wins update.
   - Hash differs on **both** sides since `lastSyncedAt` → **conflict**,
     surfaced in the Sync Preview, never auto-resolved (section 13).
   - No Firestore doc for that Product ID → create.
3. Symmetric pass Firebase → Sheet for docs whose `lastModifiedSource =
   POS` since `lastSyncedAt`.
4. Every write the sync engine itself makes sets `lastModifiedSource =
   SYSTEM` and bumps `syncVersion`, which is what breaks the
   Sheet→Firebase→Sheet loop from section 63 — a SYSTEM-sourced change is
   never re-synced back to where it came from in the same pass.

**Stock is never overwritten directly.** A stock-quantity delta detected
from either side becomes a `stockLedger` entry with `source` set
accordingly, and `currentStock` is derived by applying the ledger entry to
the previous value — never replaced wholesale (sections 14/15).

**Deletion**: a Sheet row disappearing does not delete Firestore data. It's
surfaced as "PRODUCT MISSING FROM SHEET" with Archive / Restore-to-Sheet /
Ignore actions (section 42).

## 6. Dynamic Field Engine

Product documents store known fields as top-level properties and everything
else in `customFields: {}`. `customFieldDefs` is the schema registry the
whole app reads to decide:
- what to render on the Add/Edit Product form and in what order
  (`sortOrder`),
- what to show in POS search vs. the inventory grid vs. reports
  (`visibleIn*`),
- whether the Sheet sync is allowed to write it (`editableFromSheet`) and
  whether POS may (`editableFromPos`),
- how to validate it (`fieldType`: text/number/currency/date/datetime/
  boolean/dropdown/multiselect/url/imageUrl/percentage).

Disabling a field sets `active:false` but never deletes it while any
product has data in `customFields[fieldKey]` — enforced in the delete
handler, not just documented (section 6).

## 7. Security

- Firebase Auth (email/password to start; extensible to SSO) + custom
  claims for role (`owner`, `manager`, `cashier`, `inventoryStaff`,
  `accountant`, `viewer`).
- Firestore Security Rules deny-by-default; each collection's rule checks
  the caller's role claim against a `permissions` map (section 28) — e.g. a
  `cashier` claim can create `sales` but cannot write `products.mrp`.
- No Google service-account key or Firebase Admin key ever ships to the
  browser or into the Apps Script project file — the Admin SDK only runs
  inside Cloud Functions, which read credentials from Google Cloud's
  managed environment, not source.
- `.gitignore` excludes `firebase-config.local.js` and any `*.key.json`;
  the repo ships `firebase-config.example.js` instead.

## 8. Project Structure

```
retail-pos/
├── index.html            (login)
├── dashboard.html
├── pos.html
├── inventory.html
├── products.html
├── purchases.html
├── sales.html
├── reports.html
├── sync.html
├── settings.html
├── css/
├── js/
│   ├── app/           (shell: nav, router, online/offline banner)
│   ├── auth/
│   ├── firebase/
│   ├── products/
│   ├── inventory/
│   ├── sales/
│   ├── purchases/
│   ├── customers/
│   ├── suppliers/
│   ├── reports/
│   ├── sync/
│   ├── google-sheets/  (client-side calls into the sync Cloud Function)
│   ├── config/         (dynamic field schema loader/cache)
│   └── utils/
├── assets/
├── firebase/            (firestore.rules, firestore.indexes.json)
├── functions/           (Cloud Functions: sync engine, ID allocator, etc.)
├── google-sheets/        (Apps Script source, synced via clasp)
└── README.md
```

## 9. Requirement conflicts noted (and how they're resolved)

- **"No traditional custom server" vs. "server-side sync/credentials"**:
  resolved with Cloud Functions, which is serverless-managed compute, not a
  server you run/patch yourself — satisfies both constraints.
- **"Read the entire header row dynamically" vs. "thousands of products,
  don't load everything"**: the header-row read is O(columns), not
  O(rows); row data is paged both in Apps Script (batched `getChangedInventory`)
  and in the POS product list (Firestore pagination) — these aren't
  actually in tension.
- **Two-way stock sync vs. "never overwrite stock without a ledger"**:
  resolved by making "two-way" mean *deltas become ledger entries*, not
  *last-write-wins on the raw number* (spelled out in section 5 above).

## 10. Build Phases (from section 78) & status

- **Phase 1 — done**: Firebase setup, project structure, Auth, Product
  Master, Dynamic Field engine, Firestore rules v1.
- **Phase 2 — done**: Categories, Sub Categories, Brands, and Units as
  slug-ID reference masters (`js/masters/simpleMasterService.js`), full
  Supplier and Customer masters with permanent IDs, a real Inventory screen
  (search/filter by status/low-stock/out-of-stock/expiry window/category/
  brand, sort, and a Stock Ledger + manual-adjustment panel per product),
  and Products' Brand/Category/Sub Category/Unit/Supplier fields are now
  live dropdowns (with inline "+" quick-add for Category/Sub Category/
  Brand) instead of free text. This is also what unblocks Phase 6's
  category/brand/etc. sync in both directions — see the note below.
- **Phase 3 — done**: POS Billing (`pos.html`) — scan/search (barcode
  scanners just type into the always-focused search box and hit Enter, per
  section 46; camera scanning is explicitly not implemented rather than
  faked), a live cart with per-line discount/GST, bill discount, split/
  multi-method payment, Hold/Resume Bill, and a printable invoice. `sales.html`
  lists completed sales with reprint.

  **Offline design decisions worth knowing about**, since section 30
  requires the till to survive connectivity loss without losing or
  duplicating a sale, and that genuinely conflicts with two things this
  spec also asks for:
  - *Atomic stock decrement* (section 16) normally means a Firestore
    `runTransaction` — but transactions require a live connection and will
    stall while offline. Sales instead use a `WriteBatch` with
    `currentStock: increment(-qty)` (`js/inventory/stockLedger.js`'s
    `queueSaleLineStockChange`), which queues locally and applies atomically
    on the server once synced — concurrent sales, online or not, can never
    clobber each other. The one honest cost: the Stock Ledger's
    previousStock/newStock for a sale row are the best locally-cached
    estimate at that moment, not a guaranteed fresh read, when offline.
    `currentStock` itself is always exactly correct regardless.
  - *Sequential, non-duplicate invoice numbering* (section 21) fundamentally
    needs a single coordinating writer, which two offline tills can't
    provide. The sale itself is written immediately with a client-generated
    UUID (always unique, no coordination needed) and `invoiceNumberPending:
    true`; the actual sequential number is assigned right away if online,
    or backfilled in original order (`clientSeq`) by
    `reconcilePendingInvoiceNumbers()` the moment connectivity returns. A
    completed sale is never blocked on having an invoice number yet.

  Store name/address/GSTIN for the invoice header are configurable at
  Settings → Store Info (`js/config/storeSettings.js`).

- **Phase 4 — done**: Purchase Entry (`purchases.html`) with a product
  picker (same pattern as the POS cart), per-line purchase price/GST/batch/
  expiry, and payment status; posting one increases stock through the
  transactional Stock Ledger (`applyStockChange`) — purchases are a
  back-office task at a connected terminal, not subject to the offline-till
  constraint that pushed *sales* onto `increment()`, so the simpler,
  exactly-accurate transactional path is the right one here, not a
  copy-paste of the sale path. Sales Returns and Purchase Returns
  (`returns.html`, plus a "View / Return" action on each purchase row) both
  require the original invoice/purchase reference — there is no code path
  that creates one without it (section 22) — and both cap the return
  quantity at what hasn't already been returned against that same
  reference. Dashboard now shows today's purchase count/value alongside
  sales.

  One deliberate permission fix while building this: the sales-return
  Firestore rule had allowed cashiers to write returns, which didn't match
  `PERMISSIONS.refund = false` for cashiers set back in Phase 1's
  `auth.js`. Returns are now owner/manager-only in both places, consistent.

- **Phase 6 — done**, and revised alongside Phase 2 to resolve reference
  fields correctly: the Sheet's Category/Brand/Sub Category/Unit/Supplier
  cells hold plain names, while Firestore stores those fields as master
  IDs (section 25). `functions/src/lib/masterResolver.js` resolves Sheet
  names to IDs (creating a new Category/Sub Category/Brand/Unit record on
  first sight, per section 62) before any hash comparison happens, and
  converts IDs back to names when pushing Firestore data to the Sheet.
  Suppliers are intentionally look-up-only, not auto-created — a supplier
  needs more than a bare name to be usable (section 27), so an unresolvable
  Supplier cell is left unset and reported as a sync warning rather than
  silently fabricating a supplier record. The Sync Center now shows these
  warnings alongside the new-column banner.
- **Phase 7 — done**: an Audit Log viewer (`audit.html`, owner/manager only —
  reuses the `settings` permission since that's the one existing capability
  that already means exactly "owner or manager") with module/action
  filters and pagination over the `auditLogs` every write path has been
  populating since Phase 1. A **Conflict History** panel on the same page
  shows resolved Sheet ↔ Firebase conflicts (who resolved it, which side
  won, when) — open conflicts still live on the Sync Center, which also
  gained a click-to-expand detail view on each sync log entry (errors and
  warnings, not just the summary counts). A filterable, exportable "Audit
  Report" alongside the other formal reports is Phase 8's job, not this
  one — this phase is the raw read side, not the reporting layer.

- **Phase 8 — done**: `reports.html` covers Sales Summary, Payment Mode,
  Product/Category/Brand Sales, Discount, Customer, Profit/Margin
  (approximate — see the caveat below), Purchase Summary, Supplier, Sales
  Return, Purchase Return, Stock Valuation, Low Stock, Out of Stock,
  Expired/Expiring-in-30-days, and a GST Summary grouped by HSN — each with
  a date range and CSV export (`js/reports/reportService.js`). Two things
  from section 37 are explicitly **not** covered, rather than faked: an
  Expense Report and Cash Book have no data to report on, since no
  expense-entry feature exists anywhere in the app yet; and the GST Summary
  here is a bookkeeping reference (output tax vs. input tax by HSN), not a
  filed-return-grade report — section 65 lists "GST filing" as a distinct
  future module for a reason. Profit/Margin is also an approximation: it
  costs each sale at the product's *current* purchase price, not the price
  actually paid on whichever purchase lot fulfilled that specific sale,
  because the Stock Ledger (by design, section 14) doesn't track
  per-batch cost — good for a rough margin sense, not accounting-grade COGS.

- Phase 9 (security hardening, offline polish at scale, performance,
  testing) remains scaffolded. Tell me if you want that built next.

### Phase 5 — Sheet workbook setup

Run `setup_formatWorkbook()` once from the Apps Script editor (idempotent —
safe to re-run any time) to: freeze the Inventory header row, add a Status
dropdown, protect the system-controlled columns with a warning-on-edit
(section 72), color Current Stock amber when at/below Reorder Level and
Expiry Date red when past, create the Sync Log/Sync Status/Categories/
Brands/Subcategories/Units/Suppliers/Customers tabs if missing, and write
an Instructions tab explaining all of it in plain language.

The six master tabs (Categories/Brands/Subcategories/Units/Suppliers/
Customers) are refreshed from Firestore on demand via the Sync Center's
**Mirror Masters to Sheet** button. They're deliberately **one-way**
(Firebase → Sheet), not another editable two-way surface — see the
scoping note at the top of the Phase 5 section in `google-sheets/Code.gs`
for why: Category/Brand/Sub Category/Unit/Supplier are already synced
through the Inventory tab's own columns (masterResolver.js), and these six
things already have real management screens in the POS app
(`masters.html`, `suppliers.html`, `customers.html`). Building six more
hash/conflict pipelines identical to Inventory's for tabs that are already
editable elsewhere wasn't a good use of the added complexity.

### Phase 6 setup notes

1. In the Apps Script editor (bound to your Inventory spreadsheet), paste
   `google-sheets/Code.gs`, then run `setup_generateSharedSecret` once from
   the editor and copy the logged value.
2. Deploy the script as a Web App (Execute as: Me; Access: Anyone within
   your org) and copy the `/exec` URL.
3. In `functions/`: `firebase functions:secrets:set SYNC_SHARED_SECRET`
   (paste the same value from step 1), and set `APPS_SCRIPT_URL` as a
   `.env`/params value to the URL from step 2.
4. Your spreadsheet needs an `Inventory` tab with the header row from
   section 4 of this document, and (optionally) a `Sync Log` tab with
   columns: Date, Sync ID, Added, Updated, Stock Adjustments, Conflicts,
   Errors, User.
5. Deploy `functions/`, then use the Sync Center's **Preview Changes**
   button before the first **Sync Now** to confirm the column mapping
   looks right.

### A note on the conflict-detection design

The three-way comparison (`sync.contentHash` = current Firestore content,
`sync.lastSyncedHash` = content as of the last successful sync, plus the
Sheet's freshly computed hash) is what makes "both sides changed since last
sync but ended up agreeing anyway" resolve silently instead of flagging a
false conflict, and is what makes a `SYSTEM`-sourced write from the sync
engine itself never re-trigger the opposite direction next pass (the loop
guard from section 63). If you extend the synced field set later, add the
field to all three copies of `syncFields.js`/`Code.gs` in lockstep — that
duplication is a deliberate trade documented in each file's header, not an
oversight.
