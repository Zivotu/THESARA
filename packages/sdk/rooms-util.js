function cryptoRandomUUID() {
  const cryptoImpl = globalThis.crypto || (globalThis as any).msCrypto;
  if (cryptoImpl?.randomUUID) {
    return cryptoImpl.randomUUID();
  }
  const getRandomValues = cryptoImpl?.getRandomValues?.bind(cryptoImpl);
  if (typeof getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
      16,
      20,
    )}-${hex.slice(20)}`;
  }
  return undefined;
}

function fallbackUUID() {
  const random = () =>
    Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  return `${random()}${random()}-${random()}-${random()}-${random()}-${random()}${random()}${random()}`;
}

function randomUUID() {
  return cryptoRandomUUID() || fallbackUUID();
}

module.exports = { randomUUID };
