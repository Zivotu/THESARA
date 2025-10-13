import test from 'node:test';
import assert from 'node:assert/strict';

const required = [
  'entitlements',
  'billing_events',
  'subscriptions',
  'stripe_accounts',
  'stripe_customers',
  'stripe_events',
  'payments',
  'users',
  'creators',
];

function createQuery(docs: any[]) {
  return {
    docs,
    where(field: string, op: string, value: any) {
      this.docs = this.docs.filter((d) => {
        const parts = field.split('.');
        let cur: any = d;
        for (const p of parts) cur = cur?.[p];
        if (op === '!=') return cur !== value;
        return cur === value;
      });
      return this;
    },
    limit(n: number) {
      this.docs = this.docs.slice(0, n);
      return this;
    },
    async get() {
      return {
        empty: this.docs.length === 0,
        docs: this.docs.map((d) => ({ data: () => d })),
      } as any;
    },
    doc: () => ({ set: async () => {} }),
  } as any;
}

test('entitlement helper queries', async (t) => {
  const entDocs = [
    {
      id: 'e1',
      userId: 'u1',
      feature: 'app-subscription',
      active: true,
      data: { appId: 'a1', stripeSubscriptionId: 's_active' },
    },
    {
      id: 'e2',
      userId: 'u1',
      feature: 'app-subscription',
      active: false,
      data: { appId: 'a2', stripeSubscriptionId: 's_active' },
    },
    {
      id: 'e3',
      userId: 'u1',
      feature: 'app-subscription',
      active: false,
      data: { appId: 'a1', stripeSubscriptionId: 's_active' },
    },
    {
      id: 'e4',
      userId: 'u1',
      feature: 'creator-all-access',
      active: true,
      data: { creatorId: 'c1', stripeSubscriptionId: 's_active2' },
    },
    {
      id: 'e5',
      userId: 'u2',
      feature: 'app-subscription',
      active: true,
      data: { appId: 'a4', stripeSubscriptionId: 's_incomplete' },
    },
    {
      id: 'e6',
      userId: 'u3',
      feature: 'creator-all-access',
      active: true,
      data: { creatorId: 'c3', stripeSubscriptionId: 's_unpaid' },
    },
  ];

  const subDocs: Record<string, any> = {
    s_active: { id: 's_active', status: 'active', currentPeriodEnd: Date.now() + 1000 },
    s_active2: { id: 's_active2', status: 'active', currentPeriodEnd: Date.now() + 1000 },
    s_incomplete: { id: 's_incomplete', status: 'incomplete', currentPeriodEnd: Date.now() + 1000 },
    s_unpaid: { id: 's_unpaid', status: 'unpaid', currentPeriodEnd: Date.now() + 1000 },
  };

  const fakeDb = {
    settings: () => {},
    listCollections: async () => required.map((id) => ({ id })),
    collection: (name: string) => {
      if (name === 'entitlements') return createQuery([...entDocs]);
      if (name === 'subscriptions')
        return {
          doc: (id: string) => ({
            get: async () => ({
              exists: id in subDocs,
              data: () => subDocs[id],
            }),
          }),
        } as any;
      return { doc: () => ({ set: async () => {} }) } as any;
    },
  };
  (globalThis as any).__fakeDb = fakeDb;
  const { hasAppSubscription, hasCreatorAllAccess } = await import('./db.js');
  assert.equal(await hasAppSubscription('u1', 'a1'), true);
  assert.equal(await hasAppSubscription('u1', 'a2'), false);
  assert.equal(await hasAppSubscription('u1', 'a3'), false);
  assert.equal(await hasAppSubscription('u2', 'a4'), false);
  assert.equal(await hasCreatorAllAccess('u1', 'c1'), true);
  assert.equal(await hasCreatorAllAccess('u1', 'c2'), false);
  assert.equal(await hasCreatorAllAccess('u3', 'c3'), false);
});

test('hasAppSubscription processes subscriptions in parallel', async (t) => {
  const entDocs = [
    {
      id: 'e1',
      userId: 'u1',
      feature: 'app-subscription',
      active: true,
      data: { appId: 'a1', stripeSubscriptionId: 's1' },
    },
    {
      id: 'e2',
      userId: 'u1',
      feature: 'app-subscription',
      active: true,
      data: { appId: 'a1', stripeSubscriptionId: 's2' },
    },
  ];
  const starts: string[] = [];
  const resolvers: Record<string, () => void> = {};
  const fakeDb = {
    settings: () => {},
    listCollections: async () => required.map((id) => ({ id })),
    collection: (name: string) => {
      if (name === 'entitlements') return createQuery([...entDocs]);
      if (name === 'subscriptions')
        return {
          doc: (id: string) => ({
            get: () => {
              starts.push(id);
              return new Promise((resolve) => {
                resolvers[id] = () =>
                  resolve({
                    exists: true,
                    data: () => ({
                      id,
                      status: 'active',
                      currentPeriodEnd: Date.now() + 1000,
                    }),
                  });
              });
            },
          }),
        } as any;
      return { doc: () => ({ set: async () => {} }) } as any;
    },
  };
  (globalThis as any).__fakeDb = fakeDb;
  const mod: any = await import('./db.js?app-parallel');
  const p = mod.hasAppSubscription('u1', 'a1');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(starts.sort(), ['s1', 's2']);
  resolvers['s1']();
  resolvers['s2']();
  assert.equal(await p, true);
});

test('hasCreatorAllAccess processes subscriptions in parallel', async (t) => {
  const entDocs = [
    {
      id: 'e1',
      userId: 'u1',
      feature: 'creator-all-access',
      active: true,
      data: { creatorId: 'c1', stripeSubscriptionId: 's1' },
    },
    {
      id: 'e2',
      userId: 'u1',
      feature: 'creator-all-access',
      active: true,
      data: { creatorId: 'c1', stripeSubscriptionId: 's2' },
    },
  ];
  const starts: string[] = [];
  const resolvers: Record<string, () => void> = {};
  const fakeDb = {
    settings: () => {},
    listCollections: async () => required.map((id) => ({ id })),
    collection: (name: string) => {
      if (name === 'entitlements') return createQuery([...entDocs]);
      if (name === 'subscriptions')
        return {
          doc: (id: string) => ({
            get: () => {
              starts.push(id);
              return new Promise((resolve) => {
                resolvers[id] = () =>
                  resolve({
                    exists: true,
                    data: () => ({
                      id,
                      status: 'active',
                      currentPeriodEnd: Date.now() + 1000,
                    }),
                  });
              });
            },
          }),
        } as any;
      return { doc: () => ({ set: async () => {} }) } as any;
    },
  };
  (globalThis as any).__fakeDb = fakeDb;
  const mod: any = await import('./db.js?creator-parallel');
  const p = mod.hasCreatorAllAccess('u1', 'c1');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(starts.sort(), ['s1', 's2']);
  resolvers['s1']();
  resolvers['s2']();
  assert.equal(await p, true);
});
