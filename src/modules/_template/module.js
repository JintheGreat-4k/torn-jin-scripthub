// Template for a new Scripthub module. Copy this folder to src/modules/<your-id>/,
// rename the id in module.json, then run `npm run build`. Folders starting with "_" are ignored.
// Full guide: docs/adding-a-module.md

MODULE.start = (ctx) => {
  // Everything registered through ctx (styles, elements, listeners, timers, launchers)
  // is removed automatically when the user switches the module off.
  ctx.addStyle(`
    #my-module-box{position:fixed;right:20px;bottom:20px;z-index:999999;background:#1e1f24;color:#eee;
      border:1px solid #555;border-radius:8px;padding:8px 10px;font:12px Arial,sans-serif}
  `);
  const box = ctx.mount(ctx.el('<div id="my-module-box">Loading…</div>'));

  async function update() {
    try {
      const data = await ctx.api('user/?selections=basic');   // key + comment are added by the hub
      if (!ctx.alive) return;                                 // switched off while the request ran
      box.textContent = `Hello ${data.name} [${data.player_id}]`;
    } catch (e) {
      box.textContent = '⚠ ' + e.message;
    }
  }

  update();
  ctx.setInterval(update, 60 * 1000);
  ctx.onApiKeyChange(update);

  // Optional: return a function for any extra cleanup not covered by ctx helpers.
  return () => {};
};
