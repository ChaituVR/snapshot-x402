import { mockFetch, Upstream } from './helpers';
import { HttpError } from '../src/errors';
import { createSnapshot, VpParams } from '../src/snapshot';

const CONFIG = {
  hubUrl: 'https://hub.test/graphql',
  scoreApiUrl: 'https://score.test',
  snapshotApiKey: 'secret-key'
};

const VP_PARAMS: VpParams = {
  address: '0xabc',
  network: '1',
  strategies: [],
  snapshot: 'latest',
  space: 'ens.eth'
};

function client(upstream: Upstream, apiKey = CONFIG.snapshotApiKey) {
  const fetchFn = mockFetch(() => upstream);
  return {
    fetchFn,
    snapshot: createSnapshot({ ...CONFIG, snapshotApiKey: apiKey }, fetchFn)
  };
}

async function failure(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof HttpError) return err;
    throw err;
  }
  throw new Error('expected a failure');
}

describe('hub', () => {
  it('sends the API key as a header only', async () => {
    const { fetchFn, snapshot } = client({ body: { data: { space: null } } });
    await snapshot.query('query Space { space { id } }', {});
    const [url, init] = fetchFn.mock.calls[0];

    expect(url).toBe(CONFIG.hubUrl);
    expect(url).not.toContain('apiKey');
    expect(new Headers(init?.headers).get('x-api-key')).toBe('secret-key');
  });

  it('omits the header without a key', async () => {
    const { fetchFn, snapshot } = client({ body: { data: {} } }, '');
    await snapshot.query('query X { x }', {});

    expect(
      new Headers(fetchFn.mock.calls[0][1]?.headers).has('x-api-key')
    ).toBe(false);
  });

  it.each([
    ['Invalid voter address: 0xnope', 400, 'bad_request'],
    ['space not found', 404, 'not_found'],
    ['proposal not found', 404, 'not_found'],
    [
      'The `first` argument must not be greater than 1000',
      502,
      'upstream_error'
    ],
    ['too many requests', 503, 'upstream_rate_limited']
  ])('maps "%s"', async (message, status, code) => {
    const { snapshot } = client({
      status: 500,
      body: { errors: [{ message }], data: null }
    });
    const err = await failure(snapshot.query('query X { x }', {}));

    expect(err.status).toBe(status);
    expect(err.code).toBe(code);
    expect(err.message).not.toContain('secret-key');
  });

  it('maps a timeout to 504', async () => {
    const fetchFn = jest.fn(async () => {
      throw new DOMException(
        'The operation was aborted due to timeout',
        'TimeoutError'
      );
    });
    const snapshot = createSnapshot(CONFIG, fetchFn);
    const err = await failure(snapshot.query('query X { x }', {}));

    expect(err.status).toBe(504);
    expect(err.code).toBe('upstream_timeout');
  });

  it('maps a network error to 502', async () => {
    const snapshot = createSnapshot(
      CONFIG,
      jest.fn(async () => {
        throw new TypeError('fetch failed');
      })
    );
    expect((await failure(snapshot.query('query X { x }', {}))).status).toBe(
      502
    );
  });

  it('defaults Retry-After to 60 seconds', async () => {
    const { snapshot } = client({ status: 429, body: {} });
    expect(
      (await failure(snapshot.query('query X { x }', {}))).retryAfter
    ).toBe(60);
  });
});

describe('score-api', () => {
  it('posts get_vp as JSON-RPC', async () => {
    const { fetchFn, snapshot } = client({
      body: {
        jsonrpc: '2.0',
        result: { vp: 2, vp_by_strategy: [2], vp_state: 'final' },
        id: null
      }
    });
    const result = await snapshot.getVp(VP_PARAMS);

    expect(result).toEqual({ vp: 2, vp_by_strategy: [2], vp_state: 'final' });
    expect(fetchFn.mock.calls[0][0]).toBe(CONFIG.scoreApiUrl);
    expect(JSON.parse(fetchFn.mock.calls[0][1]?.body as string)).toEqual({
      jsonrpc: '2.0',
      method: 'get_vp',
      params: VP_PARAMS,
      id: null
    });
  });

  it.each([
    [400, 'invalid address', 400],
    [400, 'invalid api key', 502],
    [500, 'something wrong with the strategies', 502],
    [429, 'too many requests', 503]
  ])('maps HTTP %i "%s"', async (status, data, expected) => {
    const { snapshot } = client({
      status,
      body: {
        jsonrpc: '2.0',
        error: { code: status, message: 'unauthorized', data },
        id: null
      }
    });
    expect((await failure(snapshot.getVp(VP_PARAMS))).status).toBe(expected);
  });

  it('rejects a result without vp', async () => {
    const { snapshot } = client({ body: { jsonrpc: '2.0', result: {} } });
    expect((await failure(snapshot.getVp(VP_PARAMS))).status).toBe(502);
  });
});
