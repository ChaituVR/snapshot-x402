import { isValidAlgorandAddress } from '@x402/avm';
import { Network } from '@x402/core/types';

export const ALGORAND_MAINNET =
  'algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=';
export const ALGORAND_TESTNET =
  'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=';
export const DEFAULT_FACILITATOR_URL = 'https://facilitator.goplausible.xyz';

const DEFAULT_TAG = 'x402-global-challenge';
const NO_TAG = 'none';
const SUBCENT_PRICE = 0.01;

export const NETWORKS: Record<
  string,
  { asset: string; algod: string; base: Network; testnet: boolean }
> = {
  [ALGORAND_MAINNET]: {
    asset: '31566704',
    algod: 'https://mainnet-api.algonode.cloud',
    base: 'eip155:8453',
    testnet: false
  },
  [ALGORAND_TESTNET]: {
    asset: '10458941',
    algod: 'https://testnet-api.algonode.cloud',
    base: 'eip155:84532',
    testnet: true
  }
};

export type PriceKey = 'read' | 'vp';

export type Config = {
  port: number;
  publicUrl: string | null;
  snapshotApiKey: string;
  hubUrl: string;
  scoreApiUrl: string;
  network: Network;
  testnet: boolean;
  asset: string;
  algodUrl: string;
  payTo: string;
  facilitatorUrl: string;
  prices: Record<PriceKey, string>;
  tag: string;
  base: { network: Network; payTo: string } | null;
};

type Env = Record<string, string | undefined>;

function read(env: Env, name: string, fallback = ''): string {
  return env[name]?.trim() || fallback;
}

function parseUrl(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an http(s) URL, got "${value}"`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${name} must be an http(s) URL, got "${value}"`);
  }
  return value.replace(/\/+$/, '');
}

function parsePrice(name: string, value: string): string {
  const match = /^\$?(\d+(?:\.\d{1,6})?)$/.exec(value);
  if (!match || Number(match[1]) <= 0) {
    throw new Error(
      `${name} must be a USDC amount above 0 with at most 6 decimals, like 0.01, got "${value}"`
    );
  }
  return match[1];
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `PORT must be an integer between 1 and 65535, got "${value}"`
    );
  }
  return port;
}

function invalidAddress(name: string, kind: string, value: string) {
  return new Error(
    `${name} must be ${kind}, got a ${value.length} character value (not shown)`
  );
}

function parseBase(env: Env, network: string): Config['base'] {
  const payTo = read(env, 'X402_PAY_TO_EVM');
  if (!payTo) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(payTo)) {
    throw invalidAddress('X402_PAY_TO_EVM', 'an EVM address', payTo);
  }
  return { network: NETWORKS[network].base, payTo };
}

function parseTag(env: Env): string {
  const tag = read(env, 'X402_TAG', DEFAULT_TAG);
  if (tag === NO_TAG) return '';
  if (!/^[\x21-\x7e]{1,32}$/.test(tag)) {
    throw new Error(
      `X402_TAG must be 1-32 printable ASCII characters without spaces, got "${tag}"`
    );
  }
  return tag;
}

export function isSubcent(price: string): boolean {
  return Number(price) < SUBCENT_PRICE;
}

export function loadConfig(env: Env = process.env): Config {
  const network = read(env, 'X402_NETWORK', ALGORAND_MAINNET);
  if (!NETWORKS[network]) {
    throw new Error(
      `X402_NETWORK must be ${ALGORAND_MAINNET} (MainNet) or ${ALGORAND_TESTNET} (TestNet), got "${network}"`
    );
  }
  const { asset, algod, testnet } = NETWORKS[network];
  const payTo = read(env, 'X402_PAY_TO');
  if (!isValidAlgorandAddress(payTo)) {
    throw invalidAddress('X402_PAY_TO', 'an Algorand address', payTo);
  }
  const publicUrl = read(env, 'PUBLIC_URL');
  if (!publicUrl && !testnet) {
    throw new Error(
      'PUBLIC_URL is required on MainNet: the Bazaar lists the origin of the first paid request'
    );
  }
  return {
    port: parsePort(read(env, 'PORT', '3000')),
    publicUrl: publicUrl ? parseUrl('PUBLIC_URL', publicUrl) : null,
    snapshotApiKey: read(env, 'SNAPSHOT_API_KEY'),
    hubUrl: parseUrl(
      'HUB_URL',
      read(env, 'HUB_URL', 'https://hub.snapshot.org/graphql')
    ),
    scoreApiUrl: parseUrl(
      'SCORE_API_URL',
      read(env, 'SCORE_API_URL', 'https://score.snapshot.org')
    ),
    network: network as Network,
    testnet,
    asset,
    algodUrl: parseUrl('ALGOD_URL', read(env, 'ALGOD_URL', algod)),
    payTo,
    facilitatorUrl: parseUrl(
      'X402_FACILITATOR_URL',
      read(env, 'X402_FACILITATOR_URL', DEFAULT_FACILITATOR_URL)
    ),
    prices: {
      read: parsePrice('X402_PRICE_READ', read(env, 'X402_PRICE_READ', '0.01')),
      vp: parsePrice('X402_PRICE_VP', read(env, 'X402_PRICE_VP', '0.02'))
    },
    tag: parseTag(env),
    base: parseBase(env, network)
  };
}
