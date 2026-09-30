import { Config } from './config';

const ALGOD_TIMEOUT_MS = 10e3;

export async function checkPayTo(
  config: Pick<Config, 'algodUrl' | 'payTo' | 'asset'>,
  fetchFn: typeof fetch = fetch
): Promise<boolean> {
  const res = await fetchFn(
    `${config.algodUrl}/v2/accounts/${config.payTo}/assets/${config.asset}`,
    { signal: AbortSignal.timeout(ALGOD_TIMEOUT_MS) }
  );
  if (res.ok) return true;
  if (res.status === 404) return false;
  throw new Error(`algod answered HTTP ${res.status}`);
}
