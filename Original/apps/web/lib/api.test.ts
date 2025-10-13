import { apiGet, apiPost, apiPatch } from '@/lib/api';
import { expect, test } from 'vitest';

test('legacy API helpers are functions', () => {
  expect(typeof apiGet).toBe('function');
  expect(typeof apiPost).toBe('function');
  expect(typeof apiPatch).toBe('function');
});
