var __name =
  (globalThis as any).__name ||
  ((globalThis as any).__name = function (fn: Function, name: string) {
    try { Object.defineProperty(fn, "name", { value: name, configurable: true }); } catch {}
    return fn;
  });

export {};
