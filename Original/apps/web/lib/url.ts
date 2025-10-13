import type { ReadonlyURLSearchParams } from 'next/navigation';

// Joins URL segments ensuring there are no duplicate slashes.
export function joinUrl(base: string, ...parts: string[]): string {
  const inputs = [base, ...parts].filter(Boolean);
  const abs = inputs.find((p) => /^https?:\/\//.test(p));
  if (abs && abs === inputs[inputs.length - 1]) {
    return abs;
  }
  const [first, ...rest] = inputs;
  const cleaned = rest
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter((p) => p.length > 0)
    .join('/');
  const joined = [first?.replace(/\/+$/, ''), cleaned].filter(Boolean).join('/');
  return joined.replace(/(?<!:)\/+/g, '/');
}

export type MaybeSearchParams = ReadonlyURLSearchParams | null | undefined;

/** Vrati string vrijednost parametra ili null (nikad undefined). */
export function readParam(sp: MaybeSearchParams, key: string): string | null {
  return sp?.get(key) ?? null;
}

/** Vrati true ako je parametar strogo "1" (npr. ?deleted=1) */
export function readFlag(sp: MaybeSearchParams, key: string): boolean {
  return (sp?.get(key) ?? '') === '1';
}
