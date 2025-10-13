export function randomUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const getRandomValues =
    globalThis.crypto?.getRandomValues?.bind(globalThis.crypto) ??
    (globalThis as any).msCrypto?.getRandomValues?.bind((globalThis as any).msCrypto);
  if (typeof getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    getRandomValues(bytes);
    // Inspired by RFC4122 section 4.4.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
      16,
      20,
    )}-${hex.slice(20)}`;
  }
  // Fallback for environments without crypto.
  const random = () =>
    Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  return `${random()}${random()}-${random()}-${random()}-${random()}-${random()}${random()}${random()}`;
}
