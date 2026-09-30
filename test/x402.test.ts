import { FacilitatorTimeoutError } from '@x402/core/server';
import request from 'supertest';
import { AppOptions, createApp } from '../src/app';
import { ALGORAND_TESTNET } from '../src/config';
import { Snapshot } from '../src/snapshot';
import space from './fixtures/space.json';
import {
  BUYER,
  decodeHeader,
  fakeFacilitator,
  PAY_TO,
  paymentFor,
  testConfig,
  TX_ID
} from './helpers';

const PROPOSAL_ID =
  '0xcd8d33f6531ed3baa3f728ca8509c66ce7505877b349e6127981e8254adf9a22';

const ROUTES = [
  { path: '/v1/spaces/ens.eth', amount: '10000' },
  { path: '/v1/spaces/ens.eth/proposals?state=active', amount: '10000' },
  { path: `/v1/proposals/${PROPOSAL_ID}`, amount: '10000' },
  { path: `/v1/proposals/${PROPOSAL_ID}/votes`, amount: '10000' },
  {
    path: '/v1/vp?voter=0x3320756d61303284b8012a660ee185c58edd3bb7&space=ens.eth',
    amount: '20000'
  }
];

function stubSnapshot(): Snapshot & { query: jest.Mock; getVp: jest.Mock } {
  return {
    query: jest.fn<Promise<any>, [string, Record<string, unknown>]>(
      async () => space.data
    ),
    getVp: jest.fn()
  };
}

function setup(env: Record<string, string> = {}, options: AppOptions = {}) {
  const facilitator = fakeFacilitator();
  const snapshot = stubSnapshot();
  const { app } = createApp(testConfig(env), {
    facilitator,
    snapshot,
    ...options
  });
  const paid = async (path: string) => {
    const unpaid = await request(app).get(path);
    return request(app).get(path).set('PAYMENT-SIGNATURE', paymentFor(unpaid));
  };
  return { app, facilitator, snapshot, paid };
}

describe('402 challenge', () => {
  it.each(ROUTES)(
    '$path answers 402 with the Algorand requirements',
    async ({ path, amount }) => {
      const { app, snapshot } = setup();
      const res = await request(app).get(path);

      expect(res.status).toBe(402);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['access-control-expose-headers']).toContain(
        'PAYMENT-REQUIRED'
      );
      expect(res.headers['access-control-expose-headers']).toContain(
        'PAYMENT-RESPONSE'
      );
      expect(res.body.error.code).toBe('payment_required');
      expect(snapshot.query).not.toHaveBeenCalled();

      const required = decodeHeader(res.headers['payment-required']);
      expect(required.x402Version).toBe(2);
      expect(required.accepts).toHaveLength(1);
      expect(required.accepts[0]).toEqual({
        scheme: 'exact',
        network: ALGORAND_TESTNET,
        amount,
        asset: '10458941',
        payTo: PAY_TO,
        maxTimeoutSeconds: 300,
        extra: {
          tag: 'x402-global-challenge',
          feePayer: 'ZMFK2OI7ZBD2U27ISERZC4S6LKM6WMFJPZQ4MYNJDZ2VNBNMBA67RA22AA'
        }
      });
      expect(required.resource.url).toContain(path.split('?')[0]);
      expect(required.resource.serviceName).toBe('Snapshot x402');
      expect(required.resource.tags).toContain('x402-global-challenge');
      expect(required.extensions?.bazaar).toMatchObject({
        info: {
          input: { type: 'http', method: 'GET' },
          output: { type: 'json' }
        }
      });
      expect(required.extensions?.['x402-merchant']).toMatchObject({
        info: { name: 'Snapshot x402' }
      });
    }
  );

  it('adds a route template for path parameters', async () => {
    const { app } = setup();
    const res = await request(app).get('/v1/spaces/aavedao.eth/proposals');
    const { bazaar } = decodeHeader(res.headers['payment-required'])
      .extensions as any;

    expect(bazaar.routeTemplate).toBe('/v1/spaces/:id/proposals');
    expect(bazaar.info.input.pathParams).toEqual({ id: 'aavedao.eth' });
  });

  it('uses the read and vp prices from the environment', async () => {
    const { app } = setup({ X402_PRICE_READ: '0.002', X402_PRICE_VP: '0.05' });
    const amount = async (path: string) =>
      decodeHeader((await request(app).get(path)).headers['payment-required'])
        .accepts[0].amount;

    expect(await amount('/v1/spaces/ens.eth')).toBe('2000');
    expect(await amount(`/v1/proposals/${PROPOSAL_ID}/votes`)).toBe('2000');
    expect(await amount('/v1/vp')).toBe('50000');
  });

  it('drops the tag when X402_TAG is none', async () => {
    const { app } = setup({ X402_TAG: 'none' });
    const required = decodeHeader(
      (await request(app).get('/v1/spaces/ens.eth')).headers['payment-required']
    );

    expect(required.accepts[0].extra).not.toHaveProperty('tag');
    expect(required.resource.tags).not.toContain('x402-global-challenge');
  });

  it('offers Base USDC second when X402_PAY_TO_EVM is set', async () => {
    const evmPayTo = '0x000000000000000000000000000000000000dEaD';
    const { app } = setup({ X402_PAY_TO_EVM: evmPayTo });
    const required = decodeHeader(
      (await request(app).get('/v1/spaces/ens.eth')).headers['payment-required']
    );

    expect(required.accepts.map(option => option.network)).toEqual([
      ALGORAND_TESTNET,
      'eip155:84532'
    ]);
    expect(required.accepts[1]).toMatchObject({
      payTo: evmPayTo,
      amount: '10000',
      extra: { tag: 'x402-global-challenge' }
    });
  });

  it('still answers 402 to unpaid requests with bad input', async () => {
    const { app } = setup();
    const responses = await Promise.all(
      [
        '/v1/vp',
        '/v1/proposals/garbage',
        '/v1/spaces/ens.eth/proposals?first=0'
      ].map(path => request(app).get(path))
    );

    expect(responses.map(res => res.status)).toEqual([402, 402, 402]);
  });

  it.each([
    '/V1/SPACES/ens.eth',
    '/v1/spaces/ens.eth/',
    '/v1//spaces/ens.eth',
    '/v1/spaces/%65ns.eth'
  ])('does not serve %s for free', async path => {
    const { app, snapshot } = setup();
    const res = await request(app).get(path);

    expect([402, 404]).toContain(res.status);
    expect(snapshot.query).not.toHaveBeenCalled();
  });

  it.each(['head', 'post', 'put', 'delete', 'patch'] as const)(
    'rejects %s on paid routes',
    async method => {
      const { app, snapshot } = setup();
      const res = await request(app)[method]('/v1/spaces/ens.eth');

      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('GET');
      expect(snapshot.query).not.toHaveBeenCalled();
    }
  );

  it('answers CORS preflights with the payment headers', async () => {
    const { app } = setup();
    const res = await request(app)
      .options('/v1/spaces/ens.eth')
      .set('Origin', 'https://agent.example')
      .set('Access-Control-Request-Method', 'GET')
      .set(
        'Access-Control-Request-Headers',
        'payment-signature,access-control-expose-headers'
      );

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['access-control-allow-headers']).toBe(
      'payment-signature,access-control-expose-headers'
    );
  });

  it('advertises https behind a TLS proxy', async () => {
    const { app } = setup();
    const res = await request(app)
      .get('/v1/spaces/ens.eth')
      .set('X-Forwarded-Proto', 'https');

    expect(decodeHeader(res.headers['payment-required']).resource.url).toMatch(
      /^https:\/\//
    );
  });
});

describe('paid requests', () => {
  it('serves the data and settles once', async () => {
    const { app, facilitator } = setup();
    const unpaid = await request(app).get('/v1/spaces/ens.eth');
    const res = await request(app)
      .get('/v1/spaces/ens.eth')
      .set('PAYMENT-SIGNATURE', paymentFor(unpaid));

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('ens.eth');
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect(facilitator.verify).toHaveBeenCalledTimes(1);
    expect(facilitator.settle).toHaveBeenCalledTimes(1);
    expect(facilitator.settle.mock.calls[0][1]).toMatchObject({
      amount: '10000',
      asset: '10458941',
      payTo: PAY_TO
    });
    expect(decodeHeader<any>(res.headers['payment-response'])).toMatchObject({
      success: true,
      transaction: TX_ID,
      network: ALGORAND_TESTNET,
      payer: BUYER
    });
  });

  it('logs the paid call', async () => {
    const logs = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const { app } = setup();
    const unpaid = await request(app).get('/v1/spaces/ens.eth');
    await request(app)
      .get('/v1/spaces/ens.eth')
      .set('PAYMENT-SIGNATURE', paymentFor(unpaid));

    const paid = logs.mock.calls.find(([line]) => line === '[x402] paid');
    expect(JSON.parse(paid?.[1])).toMatchObject({
      route: 'GET /v1/spaces/:id',
      network: ALGORAND_TESTNET,
      amount: '10000',
      transaction: TX_ID,
      payer: BUYER
    });
  });

  it('returns 402 without calling the handler when verification fails', async () => {
    const { app, facilitator, snapshot } = setup();
    facilitator.verify.mockResolvedValueOnce({
      isValid: false,
      invalidReason: 'insufficient funds'
    });
    const unpaid = await request(app).get('/v1/spaces/ens.eth');
    const res = await request(app)
      .get('/v1/spaces/ens.eth')
      .set('PAYMENT-SIGNATURE', paymentFor(unpaid));

    expect(res.status).toBe(402);
    expect(decodeHeader(res.headers['payment-required']).error).toBe(
      'insufficient funds'
    );
    expect(res.body).toEqual({
      error: { code: 'payment_rejected', message: 'insufficient funds' }
    });
    expect(snapshot.query).not.toHaveBeenCalled();
    expect(facilitator.settle).not.toHaveBeenCalled();
  });

  it('rejects a payment signed for a different price', async () => {
    const { app, facilitator } = setup();
    const unpaid = await request(app).get('/v1/spaces/ens.eth');
    const required = decodeHeader(unpaid.headers['payment-required']);
    const payload = {
      x402Version: 2,
      resource: required.resource,
      accepted: { ...required.accepts[0], amount: '1' },
      extensions: required.extensions,
      payload: { paymentGroup: ['AAAA'], paymentIndex: 0 }
    };
    const res = await request(app)
      .get('/v1/spaces/ens.eth')
      .set(
        'PAYMENT-SIGNATURE',
        Buffer.from(JSON.stringify(payload)).toString('base64')
      );

    expect(res.status).toBe(402);
    expect(facilitator.verify).not.toHaveBeenCalled();
  });

  it.each([
    ['bad input', '/v1/spaces/ens.eth/proposals?state=bogus', 400],
    ['a missing space', '/v1/spaces/nope.eth', 404]
  ])('does not settle on %s', async (_name, path, status) => {
    const { app, facilitator, snapshot } = setup();
    snapshot.query.mockResolvedValue({ space: null, proposals: [] });
    const unpaid = await request(app).get(path);
    const res = await request(app)
      .get(path)
      .set('PAYMENT-SIGNATURE', paymentFor(unpaid));

    expect(res.status).toBe(status);
    expect(facilitator.verify).toHaveBeenCalledTimes(1);
    expect(facilitator.settle).not.toHaveBeenCalled();
    expect(res.headers['payment-response']).toBeUndefined();
  });

  it('answers an unexpected handler error with 500 and does not settle', async () => {
    const { paid, facilitator, snapshot } = setup();
    snapshot.query.mockRejectedValueOnce(new TypeError('boom'));
    const res = await paid('/v1/spaces/ens.eth');

    expect(res.status).toBe(500);
    expect(res.body.error).toEqual({
      code: 'internal_error',
      message: 'Internal server error'
    });
    expect(facilitator.settle).not.toHaveBeenCalled();
  });

  it('withholds the data when the settlement fails', async () => {
    const { app, facilitator } = setup();
    facilitator.settle.mockResolvedValueOnce({
      success: false,
      errorReason: 'subcent_quota_exceeded',
      transaction: '',
      network: ALGORAND_TESTNET
    });
    const unpaid = await request(app).get('/v1/spaces/ens.eth');
    const res = await request(app)
      .get('/v1/spaces/ens.eth')
      .set('PAYMENT-SIGNATURE', paymentFor(unpaid));

    expect(res.status).toBe(402);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.error).toEqual({
      code: 'settlement_failed',
      message: expect.stringContaining('subcent_quota_exceeded')
    });
  });

  it('answers a settlement timeout with a JSON 502 that is not cached', async () => {
    const { paid, facilitator } = setup();
    facilitator.settle.mockRejectedValueOnce(
      new FacilitatorTimeoutError('settle', 45000)
    );
    const res = await paid('/v1/spaces/ens.eth');

    expect(res.status).toBe(502);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      error: {
        code: 'facilitator_error',
        message: 'Facilitator settle request timed out after 45000ms'
      }
    });
  });

  it('logs the payment id and payer when a settlement fails', async () => {
    const logs = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const { paid, facilitator } = setup();
    facilitator.settle.mockRejectedValueOnce(
      new FacilitatorTimeoutError('settle', 45000)
    );
    await paid('/v1/spaces/ens.eth');

    const failed = logs.mock.calls.find(
      ([line]) => line === '[x402] settle failed'
    );
    expect(JSON.parse(failed?.[1])).toMatchObject({
      route: 'GET /v1/spaces/:id',
      paymentId: expect.stringMatching(/^[0-9a-f]{32}$/),
      payer: BUYER
    });
  });
});

describe('payment reuse', () => {
  it('rejects a payment that was already used', async () => {
    const { app, facilitator } = setup();
    const unpaid = await request(app).get('/v1/spaces/ens.eth');
    const header = paymentFor(unpaid);
    const first = await request(app)
      .get('/v1/spaces/ens.eth')
      .set('PAYMENT-SIGNATURE', header);
    const second = await request(app)
      .get('/v1/spaces/ens.eth')
      .set('PAYMENT-SIGNATURE', header);

    expect(first.status).toBe(200);
    expect(second.status).toBe(402);
    expect(second.body.error).toEqual({
      code: 'payment_rejected',
      message: 'duplicate_payment'
    });
    expect(facilitator.verify).toHaveBeenCalledTimes(1);
    expect(facilitator.settle).toHaveBeenCalledTimes(1);
  });

  it('lets only one of several concurrent uses through', async () => {
    const { app, facilitator } = setup();
    const unpaid = await request(app).get('/v1/spaces/ens.eth');
    const header = paymentFor(unpaid);
    const responses = await Promise.all(
      [1, 2, 3].map(() =>
        request(app).get('/v1/spaces/ens.eth').set('PAYMENT-SIGNATURE', header)
      )
    );

    expect(responses.map(res => res.status).sort()).toEqual([200, 402, 402]);
    expect(facilitator.verify).toHaveBeenCalledTimes(1);
  });

  it('treats a reordered copy of the same payment as a reuse', async () => {
    const { app, facilitator } = setup();
    const unpaid = await request(app).get('/v1/spaces/ens.eth');
    const payload = decodeHeader<any>(paymentFor(unpaid));
    const reordered = {
      ...payload,
      payload: {
        paymentIndex: payload.payload.paymentIndex,
        paymentGroup: payload.payload.paymentGroup
      }
    };
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString('base64');
    await request(app)
      .get('/v1/spaces/ens.eth')
      .set('PAYMENT-SIGNATURE', encode(payload));
    const res = await request(app)
      .get('/v1/spaces/ens.eth')
      .set('PAYMENT-SIGNATURE', encode(reordered));

    expect(res.status).toBe(402);
    expect(facilitator.verify).toHaveBeenCalledTimes(1);
  });

  it('answers an unreadable payment header with a fresh 402 and no stack trace', async () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const { app, facilitator } = setup();
    const res = await request(app)
      .get('/v1/spaces/ens.eth')
      .set('PAYMENT-SIGNATURE', 'not base64 !!');

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('payment_required');
    expect(facilitator.verify).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('rate limits failed paid attempts per client', async () => {
    const { app, facilitator } = setup({}, { failedPaymentsPerMinute: 2 });
    facilitator.verify.mockResolvedValue({
      isValid: false,
      invalidReason: 'invalid_signature'
    });
    const statuses = [];
    for (let i = 0; i < 3; i++) {
      const unpaid = await request(app).get('/v1/spaces/ens.eth');
      const res = await request(app)
        .get('/v1/spaces/ens.eth')
        .set('PAYMENT-SIGNATURE', paymentFor(unpaid));
      statuses.push(res.status);
      if (res.status === 429) {
        expect(res.body.error.code).toBe('rate_limited');
        expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      }
    }

    expect(statuses).toEqual([402, 402, 429]);
    expect(facilitator.verify).toHaveBeenCalledTimes(2);
  });

  it('does not count paid calls that succeed or unpaid probes', async () => {
    const { app, paid } = setup({}, { failedPaymentsPerMinute: 1 });
    for (let i = 0; i < 3; i++) {
      expect((await paid('/v1/spaces/ens.eth')).status).toBe(200);
    }
    expect((await request(app).get('/v1/spaces/ens.eth')).status).toBe(402);
  });
});

describe('browsers', () => {
  it('get a short paywall page that points to the docs', async () => {
    const { app } = setup({ PUBLIC_URL: 'https://x402.example.com' });
    const res = await request(app)
      .get('/v1/spaces/ens.eth')
      .set('Host', 'x402.example.com')
      .set('Accept', 'text/html')
      .set('User-Agent', 'Mozilla/5.0');

    expect(res.status).toBe(402);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['payment-required']).toBeDefined();
    expect(res.text).toContain('https://x402.example.com/openapi.json');
    expect(res.text).toContain('0.01 USDC');
    expect(res.text).not.toContain('@x402/paywall');
  });
});

describe('canonical host', () => {
  const env = { PUBLIC_URL: 'https://x402.example.com' };

  it('serves the 402 on the public host', async () => {
    const { app } = setup(env);
    const res = await request(app)
      .get('/v1/spaces/ens.eth')
      .set('Host', 'x402.example.com')
      .set('X-Forwarded-Proto', 'https');

    expect(res.status).toBe(402);
    expect(decodeHeader(res.headers['payment-required']).resource.url).toBe(
      'https://x402.example.com/v1/spaces/ens.eth'
    );
  });

  it('refuses paid routes on any other host', async () => {
    const { app, facilitator } = setup(env);
    const res = await request(app)
      .get('/v1/spaces/ens.eth?x=1')
      .set('Host', 'evil.example');

    expect(res.status).toBe(421);
    expect(res.body.error).toEqual({
      code: 'misdirected_request',
      message: 'Use https://x402.example.com/v1/spaces/ens.eth?x=1'
    });
    expect(res.headers['payment-required']).toBeUndefined();
    expect(facilitator.verify).not.toHaveBeenCalled();
  });

  it('redirects free documents and keeps health checks local', async () => {
    const { app } = setup(env);
    const home = await request(app).get('/llms.txt').set('Host', 'app.fly.dev');
    const health = await request(app).get('/healthz').set('Host', '10.0.0.1');

    expect(home.status).toBe(308);
    expect(home.headers.location).toBe('https://x402.example.com/llms.txt');
    expect(health.status).toBe(200);
  });
});

describe('facilitator outage', () => {
  it('returns 503 on paid routes and keeps free routes up', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const facilitator = fakeFacilitator();
    facilitator.getSupported = jest.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    const { app } = createApp(testConfig(), {
      facilitator,
      snapshot: stubSnapshot()
    });

    const paid = await request(app).get('/v1/spaces/ens.eth');
    const health = await request(app).get('/healthz');

    expect(paid.status).toBe(503);
    expect(paid.body.error.code).toBe('facilitator_unavailable');
    expect(paid.headers['retry-after']).toBe('30');
    expect(health.status).toBe(200);
  });
});
