import { existsSync } from 'node:fs';
import { ALGORAND_TESTNET, NETWORKS } from '../src/config';

export const CLIENT_ENV_FILE = '.env.client';

export function loadEnvFiles() {
  for (const file of [CLIENT_ENV_FILE, '.env']) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

export function clientNetwork() {
  const id =
    process.env.X402_CLIENT_NETWORK ||
    process.env.X402_NETWORK ||
    ALGORAND_TESTNET;
  const network = NETWORKS[id];
  if (!network) throw new Error(`Unknown Algorand network ${id}`);
  return { id, ...network };
}
