export async function resolve(specifier, context, defaultResolve) {
  if (specifier === 'firebase-admin/app') {
    return { url: new URL('./__mocks__/firebase-admin/app.mjs', import.meta.url).href, shortCircuit: true };
  }
  if (specifier === 'firebase-admin/firestore') {
    return { url: new URL('./__mocks__/firebase-admin/firestore.mjs', import.meta.url).href, shortCircuit: true };
  }
  return defaultResolve(specifier, context);
}
