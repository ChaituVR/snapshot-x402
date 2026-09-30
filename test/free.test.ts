import request from 'supertest';
import { fakeFacilitator, PAY_TO, testConfig } from './helpers';
import { createApp } from '../src/app';
import { ALGORAND_TESTNET } from '../src/config';
import examples from '../src/examples.json';

const PUBLIC_URL = 'https://x402.example.com';
const FREE_PATHS = ['/', '/openapi.json', '/llms.txt', '/og.png', '/healthz'];

function setup(env: Record<string, string> = {}) {
  const facilitator = fakeFacilitator();
  const snapshot = { query: jest.fn(), getVp: jest.fn() };
  const { app } = createApp(testConfig(env), { facilitator, snapshot });
  return { app, facilitator, snapshot };
}

describe('free routes', () => {
  it('serves HTML with OpenGraph tags by default', async () => {
    const { app } = setup();
    const res = await request(app)
      .get('/')
      .set('Host', 'api.test')
      .set('Accept', 'text/html,*/*');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(res.text).toContain('<meta property="og:title"');
    expect(res.text).toContain(
      '<meta property="og:image" content="http://api.test/og.png">'
    );
    expect(res.text).toContain('/v1/spaces/{id}');
  });

  it('serves the service description as JSON on request', async () => {
    const { app } = setup({ PUBLIC_URL });
    const res = await request(app)
      .get('/')
      .set('Host', 'x402.example.com')
      .set('Accept', 'application/json');

    expect(res.body).toMatchObject({
      name: 'Snapshot x402',
      version: '1.0.0',
      testnet: true,
      payment: {
        scheme: 'exact',
        network: ALGORAND_TESTNET,
        asset: '10458941',
        currency: 'USDC',
        payTo: PAY_TO
      },
      links: { openapi: `${PUBLIC_URL}/openapi.json` }
    });
    expect(res.body.free).toEqual(
      FREE_PATHS.filter(path => path !== '/og.png')
    );
    expect(
      res.body.routes.map((route: { price: string }) => route.price)
    ).toEqual(['0.01', '0.01', '0.01', '0.01', '0.02']);
    expect(res.body.routes[0].example).toBe(`${PUBLIC_URL}/v1/spaces/ens.eth`);
  });

  it('serves the OpenAPI document with live prices, server and examples', async () => {
    const { app } = setup({ X402_PRICE_VP: '0.01' });
    const res = await request(app).get('/openapi.json').set('Host', 'api.test');
    const vp = res.body.paths['/v1/vp'].get;

    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\.1/);
    expect(res.body.info.version).toBe('1.0.0');
    expect(res.body.servers).toEqual([{ url: 'http://api.test' }]);
    expect(vp['x-x402']).toMatchObject({
      price: '0.01',
      network: ALGORAND_TESTNET,
      asset: '10458941',
      payTo: PAY_TO
    });
    expect(vp.responses['200'].content['application/json'].example).toEqual(
      examples.vp
    );
    for (const path of FREE_PATHS.filter(path => path !== '/og.png')) {
      expect(res.body.paths).toHaveProperty([path]);
    }
  });

  it('lists callable example URLs for every paid route', async () => {
    const { app } = setup();
    const res = await request(app)
      .get('/')
      .set('Host', 'h')
      .set('Accept', 'application/json');

    expect(
      res.body.routes.map((route: { example: string }) => route.example)
    ).toEqual([
      'http://h/v1/spaces/ens.eth',
      'http://h/v1/spaces/aavedao.eth/proposals?state=active&first=20',
      'http://h/v1/proposals/0xcd8d33f6531ed3baa3f728ca8509c66ce7505877b349e6127981e8254adf9a22',
      'http://h/v1/proposals/0xcd8d33f6531ed3baa3f728ca8509c66ce7505877b349e6127981e8254adf9a22/votes?first=100&orderBy=vp',
      'http://h/v1/vp?voter=0x3320756d61303284b8012a660ee185c58edd3bb7&proposal=0xcd8d33f6531ed3baa3f728ca8509c66ce7505877b349e6127981e8254adf9a22'
    ]);
  });

  it('serves llms.txt, the banner and health', async () => {
    const { app } = setup();
    const llms = await request(app).get('/llms.txt').set('Host', 'h');
    const image = await request(app).get('/og.png');
    const health = await request(app).get('/healthz');

    expect(llms.headers['content-type']).toContain('text/plain');
    expect(llms.text.startsWith('# Snapshot x402')).toBe(true);
    expect(llms.text).toContain('an array of indexes for approval');
    expect(llms.text).toContain('http://h/v1/spaces/ens.eth');
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.headers['cache-control']).toBe('public, max-age=86400');
    expect(health.body).toEqual({ status: 'ok' });
    expect(health.headers['cache-control']).toBe('no-store');
  });

  it('never touches the facilitator or Snapshot', async () => {
    const { app, facilitator, snapshot } = setup();
    for (const path of FREE_PATHS) {
      expect((await request(app).get(path)).status).toBe(200);
    }
    expect(facilitator.verify).not.toHaveBeenCalled();
    expect(snapshot.query).not.toHaveBeenCalled();
  });

  it('answers HEAD on free routes', async () => {
    const { app } = setup();
    expect((await request(app).head('/healthz')).status).toBe(200);
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const { app } = setup();
    const res = await request(app).get('/v2/nothing');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  it('echoes a safe request id', async () => {
    const { app } = setup();
    const kept = await request(app)
      .get('/healthz')
      .set('X-Request-Id', 'abc-123');
    const replaced = await request(app)
      .get('/healthz')
      .set('X-Request-Id', 'bad id!');

    expect(kept.headers['x-request-id']).toBe('abc-123');
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
