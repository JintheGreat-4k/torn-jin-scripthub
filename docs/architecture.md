# Architecture

The Scripthub is **one userscript** that contains a small core (the *hub*) and any number of
*modules*. Users install a single file; each module can be switched on and off at runtime.

```
src/hub/hub.json            hub metadata: version, userscript header, base grants
src/hub/core.js             the hub: storage, API helper, module lifecycle, UI
src/modules/<id>/module.json  module manifest
src/modules/<id>/*.js         module sources (concatenated in the order of "files")
        │
        ▼  tools/build.mjs
dist/torn-jin-scripthub.user.js   ← what users install (committed, served via raw.githubusercontent.com)
README.md (module table between the <!-- modules:start/end --> markers)
```

## Why a build step?

Userscript managers cannot reliably load extra code at runtime (Torn's CSP, Torn PDA
limitations, and loading remote code is a security risk). Bundling at build time keeps the
installed script self-contained, reviewable and auto-updatable through `@updateURL`, while the
sources stay split into one folder per module.

The build has no dependencies. It:

1. validates every `src/modules/*/module.json` (folders starting with `_` are skipped),
2. merges the hub's and the modules' `grants` / `connect` into one userscript header,
3. concatenates `core.js` and each module (each module wrapped in its own function scope),
4. checks that the result compiles,
5. regenerates the module table in `README.md`.

`npm run check` performs the same steps without writing and fails if `dist/` or `README.md`
differ – CI runs it so the committed bundle always matches the sources.

## Bundle layout

```js
// ==UserScript== … generated header … ==/UserScript==
(function () {
  'use strict';
  const HUB_META = { name, version, repo };
  // src/hub/core.js  → defines `Hub`
  (function (MODULE) {
    // src/modules/stock-roi/logic.js
    // src/modules/stock-roi/module.js  → sets MODULE.start
  })(Hub.define({ id: 'stock-roi', …manifest fields… }));
  // … one block per module, sorted by "order" …
  Hub.boot();
})();
```

All files of one module share a scope, so `module.js` can use functions from `logic.js`
directly. Modules cannot see each other's variables.

## Module lifecycle

1. `Hub.define(meta)` registers the module and returns its `MODULE` record.
2. The module code assigns `MODULE.start = (ctx) => { … }`.
3. `Hub.boot()` (once the page body exists) builds the UI and calls `start(ctx)` for every
   **enabled** module whose `include` patterns match the page.
4. When the user switches a module off, the hub disposes its context: every resource
   registered through `ctx` is removed, then the optional cleanup function returned by `start`
   runs. Switching it on again calls `start` with a fresh context.

If `start` throws (or its returned promise rejects), the hub disposes the context, marks the
module as *error* and shows the message in the hub panel. Other modules are unaffected.

A module is enabled if the user switched it on; if they never touched it, its manifest's
`defaultEnabled` applies. This means a newly added module starts in its default state after an
update.

## The `ctx` object

| Member | Purpose |
|---|---|
| `ctx.id`, `ctx.meta` | Module id and manifest data (`meta.version`, `meta.name`, …) |
| `ctx.alive` | `false` once the module was switched off – check it after every `await` |
| `ctx.store.get(key, default)` / `set` / `del` | Persistent storage, namespaced to the module (`mod:<id>:<key>`), shared by all Torn tabs |
| `ctx.store.onChange(key, fn)` | `fn(newValue, oldValue, remote)` – `remote` is true for changes from another tab |
| `ctx.getApiKey()` | The shared Torn API key (`''` if none) |
| `ctx.onApiKeyChange(fn)` | Runs when the key is saved, in this or another tab |
| `ctx.api(path, opts?)` | `GET https://api.torn.com/<path>` with key and `comment` added; resolves to parsed JSON, throws an `ApiError` (`e.apiCode`) on Torn errors |
| `ctx.apiUrl(path, opts?)` | Same URL without fetching (for custom handling) |
| `ctx.request({ url, timeout, responseType, … })` | Generic HTTP via `GM_xmlhttpRequest` (fallback `fetch`); resolves `{ status, text, response }` |
| `ctx.notify({ title, text, timeout, onclick })` | Desktop notification (best effort) |
| `ctx.addStyle(css)` | Injects a `<style>`; removed on stop |
| `ctx.mount(element, parent?)` | Appends an element (default `document.body`); removed on stop |
| `ctx.el(html)` / `ctx.esc(text)` | Create an element from HTML / escape text for HTML |
| `ctx.on(target, type, fn, opts?)` | `addEventListener`, removed on stop |
| `ctx.setInterval(fn, ms)` / `ctx.setTimeout(fn, ms)` | Timers, cleared on stop |
| `ctx.addLauncher({ label, title, onClick })` | Adds a tab to the hub dock on the left screen edge |
| `ctx.openHub()` | Opens the hub panel (e.g. for an "API key…" button) |
| `ctx.onCleanup(fn)` | Registers any other cleanup (workers, audio contexts, …) |
| `ctx.log(...)` / `ctx.warn(...)` | Console output prefixed with `[JinHub][<id>]` |

Anything a module creates **without** these helpers (e.g. `addEventListener` on its own panel
element) is fine as long as it disappears together with a mounted element; everything else must
be registered with `ctx.onCleanup`.

## Storage keys

| Key | Owner | Content |
|---|---|---|
| `hub:apiKey` | hub | Shared Torn API key |
| `hub:enabled` | hub | `{ <moduleId>: true/false }` – only modules the user toggled |
| `mod:<id>:<key>` | module | Whatever the module stores via `ctx.store` |

Storage uses `GM_getValue`/`GM_setValue` (shared across all tabs of the script). Without GM
support (e.g. some Torn PDA setups) it falls back to `localStorage` with the prefix `jinhub:`.

## Cross-tab behaviour

- Switching a module on/off or saving the key in one tab applies to all open Torn tabs
  (`GM_addValueChangeListener`, or the `storage` event in fallback mode).
- Modules that should only act once across tabs (like the Chain Alarm) coordinate themselves
  through `ctx.store`, e.g. with a leader heartbeat.

## Torn PDA

PDA replaces the placeholder in `core.js` with the user's key, so the key field is hidden in the
hub. HTTP and storage fall back to `fetch` / `localStorage` when GM functions are missing.

## Duplicate protection

The hub marks `<html data-jinhub="<version>">`. If a second copy of the hub runs in the same tab
(e.g. installed twice), it stays idle and logs a warning.

## Versioning

- Each module has its own `version` in `module.json` (shown in the hub). Bump it whenever the
  module changes, and add a line to the module's changelog in its doc page.
- The hub `version` in `src/hub/hub.json` is the userscript `@version`. **Bump it on every
  release** – userscript managers only update when it increases. Record it in `CHANGELOG.md`.
