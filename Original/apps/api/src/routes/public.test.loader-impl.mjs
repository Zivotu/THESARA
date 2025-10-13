export async function resolve(specifier, context, defaultResolve) {
  if (specifier === '../db.js') {
    return defaultResolve(new URL('./public.test.db.ts', import.meta.url).href, context, defaultResolve);
  }
  if (specifier === '../config.js') {
    return defaultResolve(new URL('./public.test.config.ts', import.meta.url).href, context, defaultResolve);
  }
  if (specifier === '../storage.js') {
    return defaultResolve(new URL('./public.test.storage.ts', import.meta.url).href, context, defaultResolve);
  }
  if (specifier === '../paths.js') {
    return defaultResolve(new URL('./public.test.paths.ts', import.meta.url).href, context, defaultResolve);
  }
  if (specifier === 'firebase-admin/auth') {
    return defaultResolve(new URL('./public.test.auth.ts', import.meta.url).href, context, defaultResolve);
  }
  return defaultResolve(specifier, context, defaultResolve);
}
