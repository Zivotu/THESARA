import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import rawBody from 'fastify-raw-body';
import {
  stripe,
  STRIPE_AUTOMATIC_TAX,
  GOLD_PRICE_ID,
  NOADS_PRICE_ID,
} from '../billing.js';

const required = [
  'entitlements',
  'billing_events',
  'billing_events_unmapped',
  'subscriptions',
  'stripe_accounts',
  'stripe_customers',
  'stripe_events',
  'payments',
  'users',
  'creators',
];
(globalThis as any).__fakeDb = {
  settings: () => {},
  listCollections: async () => required.map((id) => ({ id })),
  collection: (_name: string) => ({ doc: () => ({ set: async () => {} }) }),
};

mock.module('../index.js', { app: { log: { warn: () => {}, info: () => {} } } });

const service = await import('./service.js');

test('listPackages retrieves price and currency', async (t) => {
  const original = [...service.PACKAGES];
  service.PACKAGES.splice(0, service.PACKAGES.length, {
    id: 'gold',
    name: 'Gold',
    description: '',
    priceId: 'price_gold',
  });
  const retrieveMock = t.mock.method(
    stripe.prices,
    'retrieve',
    async (id: string) => {
      assert.equal(id, 'price_gold');
      return { unit_amount: 1234, currency: 'usd' } as any;
    },
  );
  const pkgs = await service.listPackages();
  assert.deepEqual(pkgs, [
    {
      id: 'gold',
      name: 'Gold',
      description: '',
      priceId: 'price_gold',
      price: 1234,
      currency: 'usd',
    },
  ]);
  assert.equal(retrieveMock.mock.callCount(), 1);
  service.PACKAGES.splice(0, service.PACKAGES.length, ...original);
});

test('refundWithConnect calls stripe with correct params', async (t) => {
  const createMock = t.mock.method(stripe.refunds, 'create', async (params: any) => {
    assert.deepStrictEqual(params, {
      payment_intent: 'pi_123',
      reverse_transfer: true,
      refund_application_fee: true,
    });
    return { id: 're_123' } as any;
  });
  const refund = await service.refundWithConnect('pi_123');
  assert.equal(refund.id, 're_123');
  assert.equal(createMock.mock.callCount(), 1);
});

test('cleanUndefined removes undefined values', () => {
  const input = {
    a: 1,
    b: undefined,
    c: { d: undefined, e: 2 },
    f: [1, undefined, { g: undefined, h: 3 }],
  } as any;
  const result = service.cleanUndefined(input);
  assert.deepEqual(result, { a: 1, c: { e: 2 }, f: [1, { h: 3 }] });
});

test('buildCheckoutPayload filters payment-only fields', () => {
  const payload = service.buildCheckoutPayload(
    {
      line_items: [{ price: 'price_test', quantity: 1 }],
      customer_creation: 'always',
      payment_intent_data: { receipt_email: 'x@example.com' },
    },
    'subscription',
  );
  assert.equal(payload.customer_creation, undefined);
  assert.equal(payload.payment_intent_data, undefined);
  assert.equal(payload.mode, 'subscription');
});

test('buildCheckoutPayload allows subscription_data', () => {
  const payload = service.buildCheckoutPayload(
    { subscription_data: { metadata: { userId: 'user1' } } },
    'subscription',
  );
  assert.deepEqual(payload.subscription_data, {
    metadata: { userId: 'user1' },
  });
});

test('refundWithConnect throws refund_failed on error', async (t) => {
  const errorMock = t.mock.method(console, 'error', () => {});
  t.mock.method(stripe.refunds, 'create', async () => {
    throw new Error('stripe_error');
  });
  await assert.rejects(service.refundWithConnect('pi_456'), /refund_failed/);
  assert.equal(errorMock.mock.callCount(), 1);
});

test('createCheckoutSession configures tax, descriptors and receipts', async (t) => {
  t.mock.method(service.dbAccess, 'getStripeAccountId', async () => 'acct_123');
  t.mock.method(service.dbAccess, 'listEntitlements', async () => []);
  const createMock = t.mock.method(
    stripe.checkout.sessions,
    'create',
    async (params: any, opts: any) => {
      if (STRIPE_AUTOMATIC_TAX) {
        assert.equal(params.automatic_tax?.enabled, true);
      } else {
        assert.equal(params.automatic_tax, undefined);
      }
      assert.equal(
        params.payment_intent_data?.statement_descriptor,
        'CreateX',
      );
      assert.equal(
        params.payment_intent_data?.receipt_email,
        'test@example.com',
      );
      assert.equal(params.client_reference_id, 'user1');
      assert.equal(params.metadata.userId, 'user1');
      assert.equal(params.subscription_data, undefined);
      assert.equal(opts.idempotencyKey, 'key-1');
      return { id: 'cs_123', url: 'https://stripe.com' } as any;
    },
  );
  const session = await service.createCheckoutSession(
    {
      creatorId: 'creator1',
      title: 'Test',
      amountCents: 500,
      currency: 'usd',
      customerEmail: 'test@example.com',
    },
    'user1',
    'key-1',
  );
  assert.equal(session.id, 'cs_123');
  assert.equal(createMock.mock.callCount(), 1);
});

test('createCheckoutSession returns purchaseNotNeeded when already purchased', async (t) => {
  t.mock.method(service.dbAccess, 'getStripeAccountId', async () => 'acct_123');
  t.mock.method(service.dbAccess, 'listEntitlements', async () => [
    { feature: 'purchase', data: { listingId: 'abc' }, active: true } as any,
    { feature: 'purchase', data: { listingId: 'xyz' }, active: true } as any,
    { feature: 'purchase', data: { listingId: 'abc' }, active: false } as any,
  ]);
  const createMock = t.mock.method(
    stripe.checkout.sessions,
    'create',
    async () => ({ id: 'should_not_create' } as any),
  );
  const session = await service.createCheckoutSession(
    {
      creatorId: 'creator1',
      title: 'Test',
      amountCents: 500,
      currency: 'usd',
      customerEmail: 'test@example.com',
      metadata: { listingId: 'abc' },
    },
    'user1',
  );
  assert.deepEqual(session, { ok: true, purchaseNotNeeded: true });
  assert.equal(createMock.mock.callCount(), 0);
});

test('createSubscriptionByPriceId configures tax, descriptors and receipts', async (t) => {
  const createMock = t.mock.method(
    stripe.checkout.sessions,
    'create',
    async (params: any) => {
      if (STRIPE_AUTOMATIC_TAX) {
        assert.equal(params.automatic_tax?.enabled, true);
      } else {
        assert.equal(params.automatic_tax, undefined);
      }
      assert.equal(params.payment_intent_data, undefined);
      assert.equal(params.customer_creation, undefined);
      assert.equal(params.client_reference_id, 'user1');
      assert.equal(params.metadata.userId, 'user1');
      assert.equal(params.subscription_data.metadata.userId, 'user1');
      return { id: 'cs_sub_123', url: 'https://stripe.com' } as any;
    },
  );
  const session = await service.createSubscriptionByPriceId(
    GOLD_PRICE_ID,
    'user1',
    'sub@example.com',
  );
  assert.equal(session.id, 'cs_sub_123');
  assert.equal(createMock.mock.callCount(), 1);
});

test('createSubscriptionByPriceId prevents duplicate gold subscription', async (t) => {
  let call = 0;
  t.mock.method(service.dbAccess, 'hasSubscriptionByPriceId', async () => ++call > 1);
  const createMock = t.mock.method(stripe.checkout.sessions, 'create', async () => ({
    id: 'cs_gold',
    url: 'https://stripe.com',
  }) as any);
  await service.createSubscriptionByPriceId(GOLD_PRICE_ID, 'user1', 'sub@example.com');
  const second = await service.createSubscriptionByPriceId(
    GOLD_PRICE_ID,
    'user1',
    'sub@example.com',
  );
  assert.deepEqual(second, { alreadySubscribed: true });
  assert.equal(createMock.mock.callCount(), 1);
});

test('createSubscriptionByPriceId prevents duplicate no-ads subscription', async (t) => {
  let call = 0;
  t.mock.method(service.dbAccess, 'hasSubscriptionByPriceId', async () => ++call > 1);
  const createMock = t.mock.method(stripe.checkout.sessions, 'create', async () => ({
    id: 'cs_noads',
    url: 'https://stripe.com',
  }) as any);
  await service.createSubscriptionByPriceId(NOADS_PRICE_ID, 'user1', 'sub@example.com');
  const second = await service.createSubscriptionByPriceId(
    NOADS_PRICE_ID,
    'user1',
    'sub@example.com',
  );
  assert.deepEqual(second, { alreadySubscribed: true });
  assert.equal(createMock.mock.callCount(), 1);
});

test('createSubscriptionByPriceId allows new session when existing is incomplete', async (t) => {
  const status = 'incomplete';
  t.mock.method(
    service.dbAccess,
    'hasSubscriptionByPriceId',
    async () => ['active', 'trialing', 'past_due'].includes(status),
  );
  const createMock = t.mock.method(stripe.checkout.sessions, 'create', async () => ({
    id: 'cs_incomplete',
    url: 'https://stripe.com',
  }) as any);
  const session = await service.createSubscriptionByPriceId(
    GOLD_PRICE_ID,
    'user1',
    'sub@example.com',
  );
  assert.equal(session.id, 'cs_incomplete');
  assert.equal(createMock.mock.callCount(), 1);
});

test('createSubscriptionByPriceId allows new session when existing is unpaid', async (t) => {
  const status = 'unpaid';
  t.mock.method(
    service.dbAccess,
    'hasSubscriptionByPriceId',
    async () => ['active', 'trialing', 'past_due'].includes(status),
  );
  const createMock = t.mock.method(stripe.checkout.sessions, 'create', async () => ({
    id: 'cs_unpaid',
    url: 'https://stripe.com',
  }) as any);
  const session = await service.createSubscriptionByPriceId(
    GOLD_PRICE_ID,
    'user1',
    'sub@example.com',
  );
  assert.equal(session.id, 'cs_unpaid');
  assert.equal(createMock.mock.callCount(), 1);
});

test('createAppSubscription finds price by appId and creates session', async (t) => {
  t.mock.method(service.dbAccess, 'getAppByIdOrSlug', async () => ({
    id: 'app1',
    stripePriceId: 'price_app',
  } as any));
  t.mock.method(service.dbAccess, 'readApps', async () => [
    { id: 'app1', stripePriceId: 'price_app' },
  ] as any);
  t.mock.method(service.dbAccess, 'readCreators', async () => [] as any);
  t.mock.method(service.dbAccess, 'hasCreatorAllAccess', async () => false);
  t.mock.method(service.dbAccess, 'hasAppSubscription', async () => false);
  const listMock = t.mock.method(stripe.prices, 'list', async () => ({
    data: [],
    has_more: false,
  }) as any);
  const createMock = t.mock.method(
    stripe.checkout.sessions,
    'create',
    async (params: any, opts: any) => {
      assert.equal(params.line_items[0].price, 'price_app');
      assert.equal(params.client_reference_id, 'user1');
      assert.equal(params.metadata.userId, 'user1');
      assert.equal(params.subscription_data.metadata.userId, 'user1');
      assert.equal(opts.idempotencyKey, 'key-app');
      return { id: 'cs_app', url: 'https://stripe.com' } as any;
    },
  );
  const session = await service.createAppSubscription(
    'app1',
    'user1',
    'app@example.com',
    undefined,
    'key-app',
  );
  assert.equal(session.id, 'cs_app');
  assert.equal(createMock.mock.callCount(), 1);
  assert.equal(listMock.mock.callCount(), 0);
});

test('createAppSubscription reuses session for same idempotencyKey', async (t) => {
  t.mock.method(service.dbAccess, 'getAppByIdOrSlug', async () => ({
    id: 'app1',
    stripePriceId: 'price_app',
  } as any));
  t.mock.method(service.dbAccess, 'readApps', async () => [
    { id: 'app1', stripePriceId: 'price_app' },
  ] as any);
  t.mock.method(service.dbAccess, 'readCreators', async () => [] as any);
  t.mock.method(service.dbAccess, 'hasCreatorAllAccess', async () => false);
  t.mock.method(service.dbAccess, 'hasAppSubscription', async () => false);
  const sessions = new Map<string, any>();
  const createMock = t.mock.method(
    stripe.checkout.sessions,
    'create',
    async (_params: any, opts: any) => {
      const key = opts.idempotencyKey;
      if (!sessions.has(key)) {
        sessions.set(key, { id: 'cs_app', url: 'https://stripe.com' });
      }
      return sessions.get(key);
    },
  );
  const key = 'key-repeat';
  const first = await service.createAppSubscription(
    'app1',
    'user1',
    undefined,
    undefined,
    key,
  );
  const second = await service.createAppSubscription(
    'app1',
    'user1',
    undefined,
    undefined,
    key,
  );
  assert.deepEqual(first, second);
  assert.equal(sessions.size, 1);
  assert.equal(createMock.mock.callCount(), 2);
});

test('createAppSubscription skips session when Stripe subscription exists', async (t) => {
  t.mock.method(service.dbAccess, 'getAppByIdOrSlug', async () => ({
    id: 'app1',
    stripePriceId: 'price_app',
  } as any));
  t.mock.method(service.dbAccess, 'readApps', async () => [
    { id: 'app1', stripePriceId: 'price_app' },
  ] as any);
  t.mock.method(service.dbAccess, 'readCreators', async () => [] as any);
  t.mock.method(service.dbAccess, 'hasCreatorAllAccess', async () => false);
  t.mock.method(service.dbAccess, 'hasAppSubscription', async () => false);
  const listMock = t.mock.method(
    stripe.subscriptions,
    'list',
    async (params: any) => {
      assert.equal(params.customer, 'cus_123');
      assert.equal(params.price, 'price_app');
      assert.equal(params.status, 'active');
      return {
        data: [
          { id: 'sub_1', customer: 'cus_123', status: 'active' },
        ],
      } as any;
    },
  );
  const createMock = t.mock.method(
    stripe.checkout.sessions,
    'create',
    async () => ({ id: 'should_not_create' } as any),
  );
  const session = await service.createAppSubscription(
    'app1',
    'user1',
    undefined,
    'cus_123',
  );
  assert.deepEqual(session, { alreadySubscribed: true });
  assert.equal(createMock.mock.callCount(), 0);
  assert.equal(listMock.mock.callCount(), 1);
});

test('createAppSubscription skips session when entitlement exists', async (t) => {
  t.mock.method(service.dbAccess, 'getAppByIdOrSlug', async () => ({
    id: 'app1',
    stripePriceId: 'price_app',
  } as any));
  t.mock.method(service.dbAccess, 'readApps', async () => [
    { id: 'app1', stripePriceId: 'price_app' },
  ] as any);
  t.mock.method(service.dbAccess, 'readCreators', async () => [] as any);
  t.mock.method(service.dbAccess, 'hasCreatorAllAccess', async () => false);
  t.mock.method(service.dbAccess, 'hasAppSubscription', async () => true);
  const createMock = t.mock.method(
    stripe.checkout.sessions,
    'create',
    async () => ({ id: 'cs_app', url: 'https://stripe.com' } as any),
  );
  const session = await service.createAppSubscription('app1', 'user1');
  assert.deepEqual(session, { alreadySubscribed: true });
  assert.equal(createMock.mock.callCount(), 0);
});

test('createAppSubscription skips session when creator all access exists', async (t) => {
  t.mock.method(service.dbAccess, 'getAppByIdOrSlug', async () => ({
    id: 'app1',
    stripePriceId: 'price_app',
    author: { uid: 'creator1' },
  } as any));
  t.mock.method(service.dbAccess, 'readApps', async () => [
    { id: 'app1', stripePriceId: 'price_app' },
  ] as any);
  t.mock.method(service.dbAccess, 'readCreators', async () => [] as any);
  const allAccessMock = t.mock.method(
    service.dbAccess,
    'hasCreatorAllAccess',
    async (_userId: string, creatorId: string) => {
      assert.equal(creatorId, 'creator1');
      return true;
    },
  );
  const hasAppSubMock = t.mock.method(service.dbAccess, 'hasAppSubscription', async () => {
    throw new Error('should not be called');
  });
  const createMock = t.mock.method(
    stripe.checkout.sessions,
    'create',
    async () => ({ id: 'cs_app', url: 'https://stripe.com' } as any),
  );
  const session = await service.createAppSubscription('app1', 'user1');
  assert.deepEqual(session, { alreadySubscribed: true });
  assert.equal(createMock.mock.callCount(), 0);
  assert.equal(hasAppSubMock.mock.callCount(), 0);
  assert.equal(allAccessMock.mock.callCount(), 1);
});

test('createSubscriptionByPriceId skips session when subscription exists', async (t) => {
  t.mock.method(service.dbAccess, 'hasSubscriptionByPriceId', async () => true);
  const createMock = t.mock.method(
    stripe.checkout.sessions,
    'create',
    async () => ({ id: 'cs_basic', url: 'https://stripe.com' } as any),
  );
  const session = await service.createSubscriptionByPriceId(
    'price_basic',
    'user1',
  );
  assert.deepEqual(session, { alreadySubscribed: true });
  assert.equal(createMock.mock.callCount(), 0);
});

test('createAppSubscription throws app_not_found when missing', async (t) => {
  t.mock.method(service.dbAccess, 'getAppByIdOrSlug', async () => undefined);
  await assert.rejects(
    service.createAppSubscription('missing', 'user1'),
    /app_not_found/,
  );
});

test('createAppSubscription throws app_inactive when status not published', async (t) => {
  t.mock.method(service.dbAccess, 'getAppByIdOrSlug', async () => ({
    id: 'app1',
    slug: 'app1',
    status: 'draft',
    state: 'active',
  } as any));
  await assert.rejects(
    service.createAppSubscription('app1', 'user1'),
    /app_inactive/,
  );
});

test('createAppSubscription throws app_inactive when state not active', async (t) => {
  t.mock.method(service.dbAccess, 'getAppByIdOrSlug', async () => ({
    id: 'app1',
    slug: 'app1',
    status: 'published',
    state: 'inactive',
  } as any));
  await assert.rejects(
    service.createAppSubscription('app1', 'user1'),
    /app_inactive/,
  );
});

test('createAppSubscription throws app_slug_not_unique on duplicate slug', async (t) => {
  t.mock.method(service.dbAccess, 'getAppByIdOrSlug', async () => {
    throw new Error('app_slug_not_unique');
  });
  await assert.rejects(
    service.createAppSubscription('dup', 'user1'),
    /app_slug_not_unique/,
  );
});

test('createCreatorAllAccessSubscription finds price by creatorId and creates session', async (t) => {
  t.mock.method(service.dbAccess, 'readApps', async () => [] as any);
  t.mock.method(service.dbAccess, 'readCreators', async () => [
    { id: 'creator1', stripeAllAccessPriceId: 'price_creator' },
  ] as any);
  t.mock.method(service.dbAccess, 'hasCreatorAllAccess', async () => false);
  const listMock = t.mock.method(stripe.prices, 'list', async () => ({
    data: [],
    has_more: false,
  }) as any);
  const createMock = t.mock.method(
    stripe.checkout.sessions,
    'create',
    async (params: any) => {
      assert.equal(params.line_items[0].price, 'price_creator');
      assert.equal(params.client_reference_id, 'user1');
      assert.equal(params.metadata.userId, 'user1');
      assert.equal(params.subscription_data.metadata.userId, 'user1');
      return { id: 'cs_creator', url: 'https://stripe.com' } as any;
    },
  );
  const session = await service.createCreatorAllAccessSubscription(
    'creator1',
    'user1',
    'creator@example.com'
  );
  assert.equal(session.id, 'cs_creator');
  assert.equal(createMock.mock.callCount(), 1);
  assert.equal(listMock.mock.callCount(), 0);
});

test('createCreatorAllAccessSubscription skips session when entitlement exists', async (t) => {
  t.mock.method(service.dbAccess, 'readApps', async () => [] as any);
  t.mock.method(service.dbAccess, 'readCreators', async () => [
    { id: 'creator1', stripeAllAccessPriceId: 'price_creator' },
  ] as any);
  t.mock.method(service.dbAccess, 'hasCreatorAllAccess', async () => true);
  const createMock = t.mock.method(
    stripe.checkout.sessions,
    'create',
    async () => ({ id: 'cs_creator', url: 'https://stripe.com' } as any),
  );
  const session = await service.createCreatorAllAccessSubscription(
    'creator1',
    'user1',
    'creator@example.com',
  );
  assert.equal(session, undefined);
  assert.equal(createMock.mock.callCount(), 0);
});

test('createAppSubscription rebuilds cache when new price appears', async (t) => {
  const apps: any[] = [{ id: 'app1', stripePriceId: 'price_app1' }];
  const readAppsMock = t.mock.method(service.dbAccess, 'readApps', async () => apps);
  t.mock.method(service.dbAccess, 'getAppByIdOrSlug', async (id: string) =>
    apps.find((a) => a.id === id) as any,
  );
  t.mock.method(service.dbAccess, 'readCreators', async () => [] as any);
  t.mock.method(service.dbAccess, 'hasCreatorAllAccess', async () => false);
  t.mock.method(service.dbAccess, 'hasAppSubscription', async () => false);
  const listMock = t.mock.method(stripe.prices, 'list', async () => ({
    data: [],
    has_more: false,
  }) as any);
  const createMock = t.mock.method(
    stripe.checkout.sessions,
    'create',
    async (params: any, opts: any) => {
      assert.equal(params.client_reference_id, 'user1');
      assert.equal(params.metadata.userId, 'user1');
      assert.equal(params.subscription_data.metadata.userId, 'user1');
      assert.ok(opts.idempotencyKey);
      return { id: `cs_${params.line_items[0].price}`, url: 'https://stripe.com' } as any;
    },
  );

  const first = await service.createAppSubscription(
    'app1',
    'user1',
    undefined,
    undefined,
    'key-first',
  );
  assert.equal(first.id, 'cs_price_app1');

  apps.push({ id: 'app2', stripePriceId: 'price_app2' });

  const second = await service.createAppSubscription(
    'app2',
    'user1',
    undefined,
    undefined,
    'key-second',
  );
  assert.equal(second.id, 'cs_price_app2');
  assert.equal(readAppsMock.mock.callCount(), 2);
  assert.equal(createMock.mock.callCount(), 2);
  assert.equal(listMock.mock.callCount(), 0);
});

test('handleWebhook ignores duplicate events', async (t) => {
  const event = {
    id: 'evt_123',
    type: 'invoice.payment_succeeded',
    data: { object: {} },
  } as any;
  let processed = false;
  t.mock.method(service.dbAccess, 'hasProcessedEvent', async () => processed);
  const markMock = t.mock.method(service.dbAccess, 'markEventProcessed', async () => {
    processed = true;
  });
  const addMock = t.mock.method(service.dbAccess, 'addPaymentRecord', async () => {});
  t.mock.method(service.dbAccess, 'logBillingEvent', async () => {});
  await service.handleWebhook(event);
  await service.handleWebhook(event);
  assert.equal(addMock.mock.callCount(), 1);
  assert.equal(markMock.mock.callCount(), 1);
});

test('handleWebhook stores customer id for user', async (t) => {
  const session = {
    id: 'cs_123',
    customer: 'cus_123',
    metadata: { userId: 'user_123' },
    amount_total: 1000,
  } as any;
  const event = {
    id: 'evt_cs',
    type: 'checkout.session.completed',
    data: { object: session },
  } as any;
  t.mock.method(service.dbAccess, 'hasProcessedEvent', async () => false);
  t.mock.method(service.dbAccess, 'markEventProcessed', async () => {});
  const addMock = t.mock.method(service.dbAccess, 'addPaymentRecord', async () => {});
  t.mock.method(service.dbAccess, 'logBillingEvent', async () => {});
  const setMock = t.mock.method(
    service.dbAccess,
    'setStripeCustomerIdForUser',
    async () => {},
  );
  await service.handleWebhook(event);
  assert.equal(addMock.mock.callCount(), 1);
  assert.equal(setMock.mock.callCount(), 1);
  assert.deepEqual(setMock.mock.calls[0].arguments, ['user_123', 'cus_123']);
});

test('handleWebhook upserts purchase entitlement on listing payment', async (t) => {
  const session = {
    id: 'cs_purchase',
    mode: 'payment',
    customer: 'cus_abc',
    metadata: { userId: 'user_123', listingId: 'listing_123' },
    payment_intent: 'pi_123',
    line_items: { data: [] },
    amount_total: 500,
  } as any;
  const event = {
    id: 'evt_purchase',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_purchase' } },
    created: 1,
  } as any;
  t.mock.method(service.dbAccess, 'hasProcessedEvent', async () => false);
  t.mock.method(service.dbAccess, 'markEventProcessed', async () => {});
  t.mock.method(stripe.checkout.sessions, 'retrieve', async () => session);
  t.mock.method(service.dbAccess, 'addPaymentRecord', async () => {});
  t.mock.method(service.dbAccess, 'setStripeCustomerIdForUser', async () => {});
  const upsertMock = t.mock.method(
    service.dbAccess,
    'upsertEntitlement',
    async () => {},
  );
  const logMock = t.mock.method(
    service.dbAccess,
    'logBillingEvent',
    async () => {},
  );
  await service.handleWebhook(event);
  assert.equal(upsertMock.mock.callCount(), 1);
  assert.deepEqual(upsertMock.mock.calls[0].arguments[0], {
    id: 'purchase-listing_123',
    userId: 'user_123',
    feature: 'purchase',
    active: true,
    data: { listingId: 'listing_123' },
  });
  assert.equal(logMock.mock.callCount(), 2);
  const purchaseLog = logMock.mock.calls[1].arguments[0];
  assert.equal(purchaseLog.eventType, 'purchase');
  assert.equal(purchaseLog.details.listingId, 'listing_123');
});

test('handleWebhook passes userId to upsertSubscription', async (t) => {
  const sub = {
    id: 'sub_123',
    status: 'active',
    current_period_end: 1700000000,
    cancel_at_period_end: false,
    metadata: { userId: 'user_456' },
    customer: 'cus_789',
    items: { data: [] },
  } as any;
  const event = {
    id: 'evt_sub',
    type: 'customer.subscription.updated',
    data: { object: sub },
  } as any;
  const upsertMock = t.mock.method(
    service.dbAccess,
    'upsertSubscription',
    async () => {},
  );
  t.mock.method(service.dbAccess, 'hasProcessedEvent', async () => false);
  t.mock.method(service.dbAccess, 'markEventProcessed', async () => {});
  t.mock.method(service.dbAccess, 'listEntitlements', async () => []);
  t.mock.method(service.dbAccess, 'logBillingEvent', async () => {});
  await service.handleWebhook(event);
  assert.equal(upsertMock.mock.callCount(), 1);
  assert.deepEqual(upsertMock.mock.calls[0].arguments[0], {
    id: 'sub_123',
    userId: 'user_456',
    status: 'active',
    currentPeriodEnd: 1700000000 * 1000,
    cancelAtPeriodEnd: false,
    customerId: 'cus_789',
    priceId: null,
  });
});

test('handleWebhook logs and skips when subscription missing userId', async (t) => {
  const sub = {
    id: 'sub_missing',
    status: 'active',
    current_period_end: 1700000000,
    cancel_at_period_end: false,
    customer: 'cus_missing',
    items: { data: [] },
  } as any;
  const event = {
    id: 'evt_missing',
    type: 'customer.subscription.updated',
    data: { object: sub },
    created: 1,
  } as any;
  t.mock.method(service.dbAccess, 'hasProcessedEvent', async () => false);
  const markMock = t.mock.method(
    service.dbAccess,
    'markEventProcessed',
    async () => {},
  );
  t.mock.method(
    service.dbAccess,
    'getUserIdByStripeCustomerId',
    async () => undefined,
  );
  const upsertMock = t.mock.method(
    service.dbAccess,
    'upsertSubscription',
    async () => {},
  );
  const logMock = t.mock.method(service.dbAccess, 'logBillingEvent', async () => {});
  const reviewMock = t.mock.method(
    service.dbAccess,
    'logUnmappedBillingEvent',
    async () => {},
  );
  await service.handleWebhook(event);
  assert.equal(upsertMock.mock.callCount(), 0);
  assert.equal(logMock.mock.callCount(), 1);
  assert.equal(logMock.mock.calls[0].arguments[0].status, 'error');
  assert.equal(reviewMock.mock.callCount(), 1);
  assert.equal(markMock.mock.callCount(), 0);
});

test('handleWebhook refreshes connect status on account.updated', async (t) => {
  const event = {
    id: 'evt_acct',
    type: 'account.updated',
    data: { object: { id: 'acct_123' } },
    created: 1,
  } as any;
  t.mock.method(service.dbAccess, 'hasProcessedEvent', async () => false);
  t.mock.method(service.dbAccess, 'markEventProcessed', async () => {});
  const readCreatorsMock = t.mock.method(
    service.dbAccess,
    'readCreators',
    async () => [{ id: 'creator1' }] as any,
  );
  const getAccMock = t.mock.method(
    service.dbAccess,
    'getStripeAccountId',
    async () => 'acct_123',
  );
  const statusMock = t.mock.method(
    service,
    'getConnectStatus',
    async () => ({ onboarded: true } as any),
  );
  const logMock = t.mock.method(service.dbAccess, 'logBillingEvent', async () => {});
  await service.handleWebhook(event);
  assert.equal(statusMock.mock.callCount(), 1);
  assert.deepEqual(statusMock.mock.calls[0].arguments, ['creator1']);
  assert.equal(logMock.mock.callCount(), 1);
  assert.equal(readCreatorsMock.mock.callCount(), 1);
  assert.equal(getAccMock.mock.callCount(), 1);
});

test('handleWebhook logs payment_intent.succeeded', async (t) => {
  const pi = {
    id: 'pi_123',
    amount_received: 1000,
    metadata: { userId: 'user_1' },
    customer: 'cus_1',
  } as any;
  const event = {
    id: 'evt_pi',
    type: 'payment_intent.succeeded',
    data: { object: pi },
    created: 2,
  } as any;
  t.mock.method(service.dbAccess, 'hasProcessedEvent', async () => false);
  t.mock.method(service.dbAccess, 'markEventProcessed', async () => {});
  const addMock = t.mock.method(service.dbAccess, 'addPaymentRecord', async () => {});
  const logMock = t.mock.method(service.dbAccess, 'logBillingEvent', async () => {});
  await service.handleWebhook(event);
  assert.equal(addMock.mock.callCount(), 1);
  assert.equal(logMock.mock.callCount(), 1);
});

test('handleWebhook logs charge.refunded', async (t) => {
  const charge = {
    id: 'ch_123',
    amount_refunded: 500,
    payment_intent: 'pi_123',
    customer: 'cus_1',
  } as any;
  const event = {
    id: 'evt_ref',
    type: 'charge.refunded',
    data: { object: charge },
    created: 3,
  } as any;
  t.mock.method(service.dbAccess, 'hasProcessedEvent', async () => false);
  t.mock.method(service.dbAccess, 'markEventProcessed', async () => {});
  const getUserMock = t.mock.method(
    service.dbAccess,
    'getUserIdByStripeCustomerId',
    async () => 'user_1',
  );
  const addMock = t.mock.method(service.dbAccess, 'addPaymentRecord', async () => {});
  const logMock = t.mock.method(service.dbAccess, 'logBillingEvent', async () => {});
  await service.handleWebhook(event);
  assert.equal(getUserMock.mock.callCount(), 1);
  assert.equal(addMock.mock.callCount(), 1);
  assert.equal(logMock.mock.callCount(), 1);
});

test('handleWebhook deactivates entitlement on refund', async (t) => {
  const charge = {
    id: 'ch_456',
    amount_refunded: 500,
    payment_intent: 'pi_456',
    customer: 'cus_1',
  } as any;
  const event = {
    id: 'evt_ref2',
    type: 'charge.refunded',
    data: { object: charge },
    created: 4,
  } as any;
  t.mock.method(service.dbAccess, 'hasProcessedEvent', async () => false);
  t.mock.method(service.dbAccess, 'markEventProcessed', async () => {});
  t.mock.method(
    service.dbAccess,
    'getUserIdByStripeCustomerId',
    async () => 'user_1',
  );
  t.mock.method(service.dbAccess, 'addPaymentRecord', async () => {});
  t.mock.method(service.dbAccess, 'logBillingEvent', async () => {});
  t.mock.method(service.dbAccess, 'listEntitlements', async () => [
    {
      id: 'purchase-listing_123',
      userId: 'user_1',
      feature: 'purchase',
      active: true,
      data: { listingId: 'listing_123', payment_intent: 'pi_456' },
    },
  ]);
  const upsertMock = t.mock.method(
    service.dbAccess,
    'upsertEntitlement',
    async () => {},
  );
  await service.handleWebhook(event);
  assert.equal(upsertMock.mock.callCount(), 1);
  assert.deepEqual(upsertMock.mock.calls[0].arguments[0], {
    id: 'purchase-listing_123',
    userId: 'user_1',
    feature: 'purchase',
    active: false,
    data: { listingId: 'listing_123', payment_intent: 'pi_456' },
  });
});

test('syncSubscription deactivates removed items', async (t) => {
  const sub = {
    id: 'sub_456',
    status: 'active',
    current_period_end: 1700000000,
    cancel_at_period_end: false,
    metadata: { userId: 'user_123' },
    customer: 'cus_123',
    items: {
      data: [
        {
          id: 'si_1',
          price: { id: 'price_app1', product: { metadata: { appId: 'app1' } } },
        },
      ],
    },
  } as any;
  const event = {
    id: 'evt_remove',
    type: 'customer.subscription.updated',
    data: { object: sub },
  } as any;
  t.mock.method(service.dbAccess, 'hasProcessedEvent', async () => false);
  t.mock.method(service.dbAccess, 'markEventProcessed', async () => {});
  t.mock.method(service.dbAccess, 'upsertSubscription', async () => {});
  t.mock.method(service.dbAccess, 'readApps', async () => []);
  t.mock.method(service.dbAccess, 'readCreators', async () => []);
  t.mock.method(service.dbAccess, 'logBillingEvent', async () => {});
  const listMock = t.mock.method(
    service.dbAccess,
    'listEntitlements',
    async () => [
      {
        id: 'appSubs-si_1',
        userId: 'user_123',
        feature: 'app-subscription',
        active: true,
        data: { appId: 'app1', stripeSubscriptionId: 'sub_456', itemId: 'si_1' },
      },
      {
        id: 'appSubs-si_2',
        userId: 'user_123',
        feature: 'app-subscription',
        active: true,
        data: { appId: 'app2', stripeSubscriptionId: 'sub_456', itemId: 'si_2' },
      },
    ],
  );
  const upsertMock = t.mock.method(
    service.dbAccess,
    'upsertEntitlement',
    async () => {},
  );
  await service.handleWebhook(event);
  assert.equal(listMock.mock.callCount(), 1);
  assert.equal(upsertMock.mock.callCount(), 2);
  const deactivatedCall = upsertMock.mock.calls.find(
    (c) => c.arguments[0].id === 'appSubs-si_2',
  );
  assert.ok(deactivatedCall);
  assert.equal(deactivatedCall.arguments[0].active, false);
});

test('POST /billing/refund returns refund result', async (t) => {
  const app = Fastify();
  const createMock = t.mock.method(
    stripe.refunds,
    'create',
    async (params: any) => {
      assert.equal(params.payment_intent, 'pi_789');
      return { id: 're_789' } as any;
    },
  );
  const billingRoutes = (await import('../routes/billing.js')).default;
  await app.register(billingRoutes);
  const res = await app.inject({
    method: 'POST',
    url: '/billing/refund',
    payload: { paymentIntentId: 'pi_789' },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { id: 're_789' });
  assert.equal(createMock.mock.callCount(), 1);
  await app.close();
});

test('POST /billing/subscriptions returns alreadySubscribed', async (t) => {
  const app = Fastify();
  app.addHook('preHandler', (req, _reply, done) => {
    (req as any).authUser = { uid: 'user1', role: 'user', claims: {} };
    done();
  });
  t.mock.method(service, 'createSubscriptionByPriceId', async () => ({
    alreadySubscribed: true,
  }) as any);
  const billingRoutes = (await import('../routes/billing.js')).default;
  await app.register(billingRoutes);
  const res = await app.inject({
    method: 'POST',
    url: '/billing/subscriptions',
    payload: { priceId: 'price_basic' },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { alreadySubscribed: true });
  await app.close();
});

test('POST /billing/subscriptions creates subscription session by priceId', async (t) => {
  const app = Fastify();
  app.addHook('preHandler', (req, _reply, done) => {
    (req as any).authUser = { uid: 'user1', role: 'user', claims: {} };
    done();
  });
  const createMock = t.mock.method(
    stripe.checkout.sessions,
    'create',
    async (params: any, opts: any) => {
      assert.equal(params.line_items[0].price, 'price_basic');
      assert.equal(params.client_reference_id, 'user1');
      assert.equal(params.metadata.userId, 'user1');
      assert.equal(params.subscription_data.metadata.userId, 'user1');
      assert.equal(opts.idempotencyKey, 'key-basic');
      return { id: 'cs_basic', url: 'https://stripe.com' } as any;
    },
  );
  const billingRoutes = (await import('../routes/billing.js')).default;
  await app.register(billingRoutes);
  const res = await app.inject({
    method: 'POST',
    url: '/billing/subscriptions',
    payload: {
      priceId: 'price_basic',
      customerEmail: 'foo@example.com',
      idempotencyKey: 'key-basic',
    },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { id: 'cs_basic', url: 'https://stripe.com' });
  assert.equal(createMock.mock.callCount(), 1);
  await app.close();
});

test('POST /billing/subscriptions/app creates app subscription session', async (t) => {
  const app = Fastify();
  app.addHook('preHandler', (req, _reply, done) => {
    (req as any).user = { uid: 'user1' };
    done();
  });
  t.mock.method(service.dbAccess, 'getAppByIdOrSlug', async () => ({
    id: '123',
    slug: 'todo-app',
    stripePriceId: 'price_app',
    author: { uid: 'creator1' },
    price: 5,
  } as any));
  t.mock.method(service.dbAccess, 'readApps', async () => [
    { id: '123', stripePriceId: 'price_app' },
  ] as any);
  t.mock.method(service.dbAccess, 'readCreators', async () => [] as any);
  t.mock.method(service.dbAccess, 'hasCreatorAllAccess', async () => false);
  t.mock.method(service.dbAccess, 'hasAppSubscription', async () => false);
  t.mock.method(service.dbAccess, 'listEntitlements', async () => []);
  t.mock.method(stripe.prices, 'list', async () => ({ data: [], has_more: false }) as any);
  const createMock = t.mock.method(
    stripe.checkout.sessions,
    'create',
    async (params: any, opts: any) => {
      assert.equal(params.client_reference_id, 'user1');
      assert.equal(params.metadata.userId, 'user1');
      assert.equal(params.subscription_data.metadata.userId, 'user1');
      assert.equal(opts.idempotencyKey, 'key-route');
      return { id: 'cs_app', url: 'https://stripe.com' } as any;
    },
  );
  const billingRoutes = (await import('../routes/billing.js')).default;
  await app.register(billingRoutes);
  const res = await app.inject({
    method: 'POST',
    url: '/billing/subscriptions/app',
    payload: {
      appId: 'todo-app',
      customerEmail: 'foo@example.com',
      idempotencyKey: 'key-route',
    },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { id: 'cs_app', url: 'https://stripe.com' });
  assert.equal(createMock.mock.callCount(), 1);
  await app.close();
});

test('createAppSubscription falls back to ensure price when missing', async (t) => {
  const apps = [{ id: '123', slug: 'todo-app', price: 5, author: { uid: 'creator1' } }];
  t.mock.method(service.dbAccess, 'getAppByIdOrSlug', async () => apps[0] as any);
  t.mock.method(service.dbAccess, 'readApps', async () => apps as any);
  t.mock.method(service.dbAccess, 'readCreators', async () => [] as any);
  t.mock.method(service.dbAccess, 'hasCreatorAllAccess', async () => false);
  t.mock.method(service.dbAccess, 'hasAppSubscription', async () => false);
  t.mock.method(service.dbAccess, 'listEntitlements', async () => []);
  const products = await import('./products.js');
  const ensureMock = t.mock.method(products, 'ensureAppProductPrice', async (app: any) => {
    apps[0].stripePriceId = 'price_app';
    return { ...app, stripePriceId: 'price_app', stripeProductId: 'prod1' };
  });
  const createMock = t.mock.method(
    stripe.checkout.sessions,
    'create',
    async (_params: any, opts: any) => {
      assert.equal(opts.idempotencyKey, 'key-fallback');
      return { id: 'cs_app', url: 'https://stripe.com' } as any;
    },
  );
  const session = await service.createAppSubscription(
    'todo-app',
    'user1',
    undefined,
    undefined,
    'key-fallback',
  );
  assert.deepEqual(session, { id: 'cs_app', url: 'https://stripe.com' });
  assert.equal(ensureMock.mock.callCount(), 1);
  assert.equal(createMock.mock.callCount(), 1);
});

test('POST /billing/subscriptions/creator creates creator subscription session', async (t) => {
  const app = Fastify();
  app.addHook('preHandler', (req, _reply, done) => {
    (req as any).user = { uid: 'user1' };
    done();
  });
  t.mock.method(service.dbAccess, 'readApps', async () => [] as any);
  t.mock.method(service.dbAccess, 'readCreators', async () => [
    { id: 'creator1', stripeAllAccessPriceId: 'price_creator' },
  ] as any);
  t.mock.method(service.dbAccess, 'listEntitlements', async () => []);
  t.mock.method(stripe.prices, 'list', async () => ({ data: [], has_more: false }) as any);
  const createMock = t.mock.method(
    stripe.checkout.sessions,
    'create',
    async (params: any) => {
      assert.equal(params.client_reference_id, 'user1');
      assert.equal(params.metadata.userId, 'user1');
      assert.equal(params.subscription_data.metadata.userId, 'user1');
      return { id: 'cs_creator', url: 'https://stripe.com' } as any;
    },
  );
  const billingRoutes = (await import('../routes/billing.js')).default;
  await app.register(billingRoutes);
  const res = await app.inject({
    method: 'POST',
    url: '/billing/subscriptions/creator',
    payload: { creatorId: 'creator1', customerEmail: 'bar@example.com' },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { id: 'cs_creator', url: 'https://stripe.com' });
  assert.equal(createMock.mock.callCount(), 1);
  await app.close();
});

test('POST /billing/stripe/webhook forwards raw body to stripe', async (t) => {
  const app = Fastify();
  await app.register(rawBody, { field: 'rawBody', global: false, encoding: 'utf8' });
  const billingRoutes = (await import('../routes/billing.js')).default;
  await app.register(billingRoutes);

  const payload = '{"test":1}';
  const signature = 'sig_test';

  const constructMock = t.mock.method(
    stripe.webhooks,
    'constructEvent',
    (body: any, sig: any) => {
      assert.equal(body, payload);
      assert.equal(sig, signature);
      return { id: 'evt_1', type: 'account.updated', data: { object: {} } } as any;
    },
  );
  t.mock.method(service.dbAccess, 'hasProcessedEvent', async () => false);
  t.mock.method(service.dbAccess, 'markEventProcessed', async () => {});
  t.mock.method(service, 'handleWebhook', async () => ({} as any));

  const res = await app.inject({
    method: 'POST',
    url: '/billing/stripe/webhook',
    payload,
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { received: true });
  assert.equal(constructMock.mock.callCount(), 1);

  await app.close();
});

test('listInvoices returns sorted invoices and next payment date', async (t) => {
  const listMock = t.mock.method(stripe.invoices, 'list', async () => ({
    data: [
      { id: 'in_2', total: 200, currency: 'usd', created: 200, status: 'paid' },
      { id: 'in_1', total: 100, currency: 'usd', created: 100, status: 'open' },
    ],
    has_more: false,
  }) as any);
  const subMock = t.mock.method(stripe.subscriptions, 'list', async () => ({
    data: [{ current_period_end: 300 }],
    has_more: false,
  }) as any);
  const result = await service.listInvoices('cus_123');
  assert.deepEqual(
    result.invoices.map((i) => i.id),
    ['in_1', 'in_2'],
  );
  assert.equal(
    result.nextPaymentDate,
    new Date(300 * 1000).toISOString(),
  );
  assert.equal(listMock.mock.callCount(), 1);
  assert.equal(subMock.mock.callCount(), 1);
});

test('GET /billing/invoices returns invoice list', async (t) => {
  const app = Fastify();
  t.mock.method(stripe.invoices, 'list', async () => ({
    data: [
      { id: 'in_1', total: 100, currency: 'usd', created: 100, status: 'paid' },
    ],
    has_more: false,
  }) as any);
  t.mock.method(stripe.subscriptions, 'list', async () => ({
    data: [],
    has_more: false,
  }) as any);
  const billingRoutes = (await import('../routes/billing.js')).default;
  await app.register(billingRoutes);
  const res = await app.inject({
    method: 'GET',
    url: '/billing/invoices?customerId=cus_123',
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    invoices: [
      {
        id: 'in_1',
        amount: 100,
        currency: 'usd',
        date: new Date(100 * 1000).toISOString(),
        status: 'paid',
      },
    ],
  });
  await app.close();
});

test('upgradeSubscription updates stripe subscription price', async (t) => {
  t.mock.method(stripe.subscriptions, 'retrieve', async (id: string) => {
    assert.equal(id, 'sub_up');
    return { items: { data: [{ id: 'si_old' }] } } as any;
  });
  const updateMock = t.mock.method(
    stripe.subscriptions,
    'update',
    async (id: string, params: any) => {
      assert.equal(id, 'sub_up');
      assert.deepEqual(params, {
        cancel_at_period_end: false,
        proration_behavior: 'create_prorations',
        items: [{ id: 'si_old', price: 'price_new' }],
        metadata: { action: 'upgrade' },
      });
      return { id: 'sub_up', status: 'active' } as any;
    },
  );
  const result = await service.upgradeSubscription('sub_up', 'price_new');
  assert.deepEqual(result, { id: 'sub_up', status: 'active' });
  assert.equal(updateMock.mock.callCount(), 1);
});

test('downgradeSubscription updates stripe subscription price', async (t) => {
  t.mock.method(stripe.subscriptions, 'retrieve', async (id: string) => {
    assert.equal(id, 'sub_down');
    return { items: { data: [{ id: 'si_old' }] } } as any;
  });
  const updateMock = t.mock.method(
    stripe.subscriptions,
    'update',
    async (id: string, params: any) => {
      assert.equal(id, 'sub_down');
      assert.deepEqual(params, {
        cancel_at_period_end: false,
        proration_behavior: 'create_prorations',
        items: [{ id: 'si_old', price: 'price_new' }],
        metadata: { action: 'downgrade' },
      });
      return { id: 'sub_down', status: 'active' } as any;
    },
  );
  const result = await service.downgradeSubscription('sub_down', 'price_new');
  assert.deepEqual(result, { id: 'sub_down', status: 'active' });
  assert.equal(updateMock.mock.callCount(), 1);
});

test('cancelSubscription sets cancel_at_period_end', async (t) => {
  const updateMock = t.mock.method(
    stripe.subscriptions,
    'update',
    async (id: string, params: any) => {
      assert.equal(id, 'sub_cancel');
      assert.deepEqual(params, { cancel_at_period_end: true });
      return { id: 'sub_cancel', status: 'active' } as any;
    },
  );
  const result = await service.cancelSubscription('sub_cancel');
  assert.deepEqual(result, { id: 'sub_cancel', status: 'active' });
  assert.equal(updateMock.mock.callCount(), 1);
});

test('POST /billing/subscriptions/upgrade updates subscription', async (t) => {
  const app = Fastify();
  t.mock.method(stripe.subscriptions, 'retrieve', async () => ({
    items: { data: [{ id: 'si_old' }] },
  }) as any);
  const updateMock = t.mock.method(
    stripe.subscriptions,
    'update',
    async (_id: string, params: any) => {
      assert.deepEqual(params, {
        cancel_at_period_end: false,
        proration_behavior: 'create_prorations',
        items: [{ id: 'si_old', price: 'price_new' }],
        metadata: { action: 'upgrade' },
      });
      return { id: 'sub_up', status: 'active' } as any;
    },
  );
  const billingRoutes = (await import('../routes/billing.js')).default;
  await app.register(billingRoutes);
  const res = await app.inject({
    method: 'POST',
    url: '/billing/subscriptions/upgrade',
    payload: { subscriptionId: 'sub_up', priceId: 'price_new' },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { id: 'sub_up', status: 'active' });
  assert.equal(updateMock.mock.callCount(), 1);
  await app.close();
});

test('POST /billing/subscriptions/downgrade updates subscription', async (t) => {
  const app = Fastify();
  t.mock.method(stripe.subscriptions, 'retrieve', async () => ({
    items: { data: [{ id: 'si_old' }] },
  }) as any);
  const updateMock = t.mock.method(
    stripe.subscriptions,
    'update',
    async (_id: string, params: any) => {
      assert.deepEqual(params, {
        cancel_at_period_end: false,
        proration_behavior: 'create_prorations',
        items: [{ id: 'si_old', price: 'price_new' }],
        metadata: { action: 'downgrade' },
      });
      return { id: 'sub_down', status: 'active' } as any;
    },
  );
  const billingRoutes = (await import('../routes/billing.js')).default;
  await app.register(billingRoutes);
  const res = await app.inject({
    method: 'POST',
    url: '/billing/subscriptions/downgrade',
    payload: { subscriptionId: 'sub_down', priceId: 'price_new' },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { id: 'sub_down', status: 'active' });
  assert.equal(updateMock.mock.callCount(), 1);
  await app.close();
});

test('POST /billing/subscriptions/cancel cancels subscription', async (t) => {
  const app = Fastify();
  const updateMock = t.mock.method(
    stripe.subscriptions,
    'update',
    async () => ({ id: 'sub_cancel', status: 'active' } as any),
  );
  const billingRoutes = (await import('../routes/billing.js')).default;
  await app.register(billingRoutes);
  const res = await app.inject({
    method: 'POST',
    url: '/billing/subscriptions/cancel',
    payload: { subscriptionId: 'sub_cancel' },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { id: 'sub_cancel', status: 'active' });
  assert.equal(updateMock.mock.callCount(), 1);
  await app.close();
});

test('POST /billing/sync-checkout rejects mismatched checkout session', async (t) => {
  const app = Fastify();
  app.addHook('preHandler', (req, _reply, done) => {
    (req as any).authUser = { uid: 'user1', role: 'user', claims: {} };
    done();
  });
  t.mock.method(stripe.checkout.sessions, 'retrieve', async () => ({
    id: 'cs_test',
    mode: 'subscription',
    subscription: 'sub_123',
    client_reference_id: 'user2',
    metadata: { userId: 'user2' },
  }) as any);
  const billingRoutes = (await import('../routes/billing.js')).default;
  await app.register(billingRoutes);
  const res = await app.inject({
    method: 'POST',
    url: '/billing/sync-checkout?session_id=cs_test',
  });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: 'session_mismatch' });
  await app.close();
});

test('POST /billing/sync-checkout logs event and /billing/history returns it', async (t) => {
  const events: any[] = [];
  const app = Fastify();
  app.addHook('preHandler', (req, _reply, done) => {
    (req as any).authUser = { uid: 'user1', role: 'user', claims: {} };
    done();
  });
  t.mock.method(stripe.checkout.sessions, 'retrieve', async () => ({
    id: 'cs_ok',
    mode: 'subscription',
    subscription: 'sub_ok',
    client_reference_id: 'user1',
    amount_total: 500,
    created: 1,
    customer: 'cus_1',
    metadata: { userId: 'user1' },
  }) as any);
  t.mock.method(stripe.subscriptions, 'retrieve', async () => ({
    id: 'sub_ok',
    status: 'active',
    current_period_end: 2,
    cancel_at_period_end: false,
    customer: 'cus_1',
    items: {
      data: [
        {
          id: 'si_1',
          price: { id: 'price_1', product: { id: 'prod_1', metadata: {} }, metadata: {} },
        },
      ],
    },
    metadata: { userId: 'user1' },
  }) as any);
  const upsertSubMock = t.mock.method(
    service.dbAccess,
    'upsertSubscription',
    async () => {},
  );
  const upsertUserSubMock = t.mock.method(
    service.dbAccess,
    'upsertUserSubscription',
    async () => {},
  );
  t.mock.method(service.dbAccess, 'listEntitlements', async () => []);
  t.mock.method(service.dbAccess, 'upsertEntitlement', async () => {});
  t.mock.method(service.dbAccess, 'readApps', async () => []);
  t.mock.method(service.dbAccess, 'readCreators', async () => []);
  t.mock.method(service.dbAccess, 'logBillingEvent', async (ev) => {
    events.push(ev);
  });
  t.mock.method(service.dbAccess, 'addPaymentRecord', async () => {});
  const dbMod = await import('../db.js');
  t.mock.method(dbMod, 'listBillingEventsForUser', async (uid: string) =>
    events.filter((e) => e.userId === uid),
  );
  const billingRoutes = (await import('../routes/billing.js')).default;
  await app.register(billingRoutes);
  const res = await app.inject({
    method: 'POST',
    url: '/billing/sync-checkout?session_id=cs_ok',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, 'checkout.session.completed.sync');
  assert.equal(upsertSubMock.mock.callCount(), 1);
  assert.equal(upsertUserSubMock.mock.callCount(), 1);
  const hist = await app.inject({ method: 'GET', url: '/billing/history' });
  assert.equal(hist.statusCode, 200);
  assert.deepEqual(hist.json(), events);
  await app.close();
});
