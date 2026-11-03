# Changelog

Releases of the installable hub (`dist/torn-jin-scripthub.user.js`). Module-level changes are
listed in each module's doc page under `docs/modules/`.

## 1.0.0

- New: **Torn Jin Scripthub** – a single userscript that bundles all tools as modules that can be
  switched on and off at runtime, synced across all open Torn tabs.
- Shared Torn API key for all modules (Torn PDA key supported automatically).
- Launcher dock on the left screen edge (🧩 Hub + one tab per module window).
- Modules:
  - 📈 **Stock ROI** 1.1.0 – ported from the standalone *Torn Stock ROI* userscript (on by default).
  - ⛓ **Chain Alarm** 1.1.0 – ported from the standalone *Torn Chain-Alarm* userscript (off by default).
- The standalone `scripts/torn-stock-roi.user.js` was removed; see the README for migration.
