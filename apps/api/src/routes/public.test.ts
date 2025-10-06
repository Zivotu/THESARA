import test from 'node:test';
import assert from 'node:assert/strict';

async function setup(appIdValue: string | number) {
  globalThis.__ents = [
    { feature: 'app-subscription', active: true, data: { appId: appIdValue, expiresAt: Date.now() + 1000 } },
  ];
  const mod: any = await import(`./public.ts?case=${String(appIdValue)}`);
  await mod.default({ get() {} } as any);
  return mod.__testing.isAllowedToPlay as (req: any, item: any) => Promise<boolean>;
}

test('allows access when entitlement appId is numeric', async () => {
  const isAllowedToPlay = await setup(123);
  const req = { authUser: { uid: 'u1', role: 'user', claims: {} } } as any;
  const item = { id: 123, price: 10, author: { uid: 'u2' } } as any;
  assert.equal(await isAllowedToPlay(req, item), true);
});

test('allows access when entitlement appId is string', async () => {
  const isAllowedToPlay = await setup('123');
  const req = { authUser: { uid: 'u1', role: 'user', claims: {} } } as any;
  const item = { id: 123, price: 10, author: { uid: 'u2' } } as any;
  assert.equal(await isAllowedToPlay(req, item), true);
});
