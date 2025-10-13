import { describe, expect, it } from 'vitest';
import { normalizeApiUrl } from './apiBase';

describe('normalizeApiUrl', () => {
  it('appends /api when using thesara API domain without path', () => {
    expect(normalizeApiUrl('https://api.thesara.space')).toBe(
      'https://api.thesara.space/api',
    );
  });

  it('preserves explicit /api path and trims trailing slashes', () => {
    expect(normalizeApiUrl('https://api.thesara.space/api/')).toBe(
      'https://api.thesara.space/api',
    );
  });

  it('keeps local dev base untouched to avoid breaking localhost flows', () => {
    expect(normalizeApiUrl('http://127.0.0.1:8788')).toBe('http://127.0.0.1:8788');
  });
});
