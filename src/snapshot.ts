import { Config } from './config';
import { badRequest, HttpError, notFound } from './errors';
import { log } from './log';

const HUB_TIMEOUT_MS = 6e3;
const SCORE_TIMEOUT_MS = 12e3;
const DEFAULT_RETRY_AFTER = 60;

type Upstream = 'hub' | 'score-api';

type Fetch = typeof fetch;

export type Strategy = {
  name: string;
  network: string;
  params: Record<string, unknown>;
};

export type VpParams = {
  address: string;
  network: string;
  strategies: Strategy[];
  snapshot: number | 'latest';
  space: string;
};

export type VpResult = {
  vp: number;
  vp_by_strategy: number[];
  vp_state: string;
};

export type Snapshot = {
  query<T>(query: string, variables: Record<string, unknown>): Promise<T>;
  getVp(params: VpParams): Promise<VpResult>;
};

const upstreamError = (upstream: Upstream) =>
  new HttpError(502, 'upstream_error', `Snapshot ${upstream} request failed`);

function rateLimited(upstream: Upstream, res?: Response) {
  const reset = Number(res?.headers.get('ratelimit-reset'));
  return new HttpError(
    503,
    'upstream_rate_limited',
    `Snapshot ${upstream} is rate limiting this service, retry later`,
    Number.isInteger(reset) && reset > 0 ? reset : DEFAULT_RETRY_AFTER
  );
}

function isTimeout(err: unknown) {
  const name = (err as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

function mapHubMessage(message: string): HttpError {
  if (/invalid (voter )?address/i.test(message)) {
    return badRequest('Invalid address');
  }
  if (/(space|proposal) not found/i.test(message)) {
    return notFound(message.charAt(0).toUpperCase() + message.slice(1));
  }
  if (/too many requests|rate limit/i.test(message)) return rateLimited('hub');
  if (/invalid api key/i.test(message)) {
    log('snapshot', 'hub rejected SNAPSHOT_API_KEY');
  }
  return upstreamError('hub');
}

function mapScoreError(data: string): HttpError {
  if (/invalid address/i.test(data)) return badRequest('Invalid address');
  if (/too many requests/i.test(data)) return rateLimited('score-api');
  if (/invalid api key/i.test(data)) {
    log('snapshot', 'score-api rejected SNAPSHOT_API_KEY');
  }
  return upstreamError('score-api');
}

export function createSnapshot(
  config: Pick<Config, 'hubUrl' | 'scoreApiUrl' | 'snapshotApiKey'>,
  fetchFn: Fetch = fetch
): Snapshot {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json'
  };
  if (config.snapshotApiKey) headers['x-api-key'] = config.snapshotApiKey;

  async function post(
    upstream: Upstream,
    url: string,
    body: unknown,
    timeoutMs: number
  ): Promise<{ res: Response; json: any }> {
    const started = Date.now();
    try {
      const res = await fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (res.status === 429) throw rateLimited(upstream, res);
      if (res.status === 401) {
        log('snapshot', `${upstream} rejected SNAPSHOT_API_KEY`);
        throw upstreamError(upstream);
      }
      const json = await res.json().catch(err => {
        if (isTimeout(err)) throw err;
        throw upstreamError(upstream);
      });
      return { res, json };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (isTimeout(err)) {
        throw new HttpError(
          504,
          'upstream_timeout',
          `Snapshot ${upstream} did not answer in time`
        );
      }
      log('snapshot', `${upstream} unreachable`, {
        ms: Date.now() - started,
        error: err instanceof Error ? err.message : String(err)
      });
      throw upstreamError(upstream);
    }
  }

  return {
    async query<T>(query: string, variables: Record<string, unknown>) {
      const { res, json } = await post(
        'hub',
        config.hubUrl,
        { query, variables },
        HUB_TIMEOUT_MS
      );
      const message = json?.errors?.[0]?.message;
      if (typeof message === 'string') throw mapHubMessage(message);
      if (!res.ok || !json?.data) throw upstreamError('hub');
      return json.data as T;
    },

    async getVp(params: VpParams) {
      const { res, json } = await post(
        'score-api',
        config.scoreApiUrl,
        { jsonrpc: '2.0', method: 'get_vp', params, id: null },
        SCORE_TIMEOUT_MS
      );
      if (json?.error) throw mapScoreError(String(json.error.data ?? ''));
      const result = json?.result;
      if (!res.ok || typeof result?.vp !== 'number') {
        throw upstreamError('score-api');
      }
      return result as VpResult;
    }
  };
}
