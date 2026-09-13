const { setUserRole } = require('./setUserRole');
const { previewSync, syncNow, resolveConflict, resolveMissingFromSheet } = require('./sync');
const { mirrorMastersToSheet } = require('./masterMirror');

exports.setUserRole = setUserRole;

// Phase 6 — Sync Engine (see README.md section 5 for the design these
// implement): previewSync is read-only and safe to call as often as the
// Sync Center wants; syncNow recomputes the same diff server-side rather
// than trusting whatever the client last rendered, and applies it.
exports.previewSync = previewSync;
exports.syncNow = syncNow;
exports.resolveConflict = resolveConflict;
exports.resolveMissingFromSheet = resolveMissingFromSheet;

// Phase 5 — one-way Firebase -> Sheet mirror for the Categories/Brands/
// Subcategories/Units/Suppliers/Customers reference tabs.
exports.mirrorMastersToSheet = mirrorMastersToSheet;
