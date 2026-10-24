// Vitest setup (jsdom). Node ≥ 22 defines its own localStorage / sessionStorage globals (undefined
// without --localstorage-file), and vitest then skips installing jsdom's. Point both at jsdom's
// window so storage-backed code (ui/theme.ts, the LocalSource) behaves like in the browser.
const dom = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom;
if (dom) {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, get: () => dom.window[key] });
  }
}
