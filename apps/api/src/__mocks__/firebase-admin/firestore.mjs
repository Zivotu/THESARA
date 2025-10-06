export const FieldValue = {};
export const Timestamp = { now: () => ({}) };
export function getFirestore() {
  return globalThis.__fakeDb;
}
