import { GET } from './route';
import { afterEach, expect, test } from 'vitest';

afterEach(() => {
  delete process.env.PRO_GOLD_PRICE;
  delete process.env.PRO_NOADS_PRICE;
  delete process.env.PRO_MONTHLY_PRICE;
});

test('returns price for gold plan', async () => {
  process.env.PRO_GOLD_PRICE = '19.99';
  const res = await GET(new Request('http://localhost/api/pro/price?plan=gold'));
  const json = await res.json();
  expect(json.price).toBe(19.99);
});

test('returns price for noads plan', async () => {
  process.env.PRO_NOADS_PRICE = '4.99';
  const res = await GET(new Request('http://localhost/api/pro/price?plan=noads'));
  const json = await res.json();
  expect(json.price).toBe(4.99);
});
