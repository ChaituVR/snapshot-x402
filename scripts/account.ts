import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import algosdk from 'algosdk';
import { CLIENT_ENV_FILE, clientNetwork, loadEnvFiles } from './env';

const ROLES = {
  buyer: 'ALGORAND_BUYER_MNEMONIC',
  payto: 'ALGORAND_PAY_TO_MNEMONIC'
} as const;
const MIN_ALGO_FOR_OPT_IN = 201_000n;

type Role = keyof typeof ROLES;

loadEnvFiles();
const network = clientNetwork();
const algod = new algosdk.Algodv2('', network.algod, '');

function account(role: Role) {
  const mnemonic = process.env[ROLES[role]]?.trim();
  if (!mnemonic) {
    throw new Error(
      `${ROLES[role]} is not set. Run "yarn account new ${role}" first.`
    );
  }
  return algosdk.mnemonicToSecretKey(mnemonic);
}

function create(role: Role) {
  if (process.env[ROLES[role]]) {
    throw new Error(`${ROLES[role]} is already set in the environment`);
  }
  const { addr, sk } = algosdk.generateAccount();
  const line = `${ROLES[role]}=${algosdk.secretKeyToMnemonic(sk)}`;
  const current = existsSync(CLIENT_ENV_FILE)
    ? readFileSync(CLIENT_ENV_FILE, 'utf8')
    : '';
  const empty = new RegExp(`^${ROLES[role]}=\\s*$`, 'm');
  writeFileSync(
    CLIENT_ENV_FILE,
    empty.test(current)
      ? current.replace(empty, line)
      : `${current}${current && !current.endsWith('\n') ? '\n' : ''}${line}\n`,
    { mode: 0o600 }
  );
  chmodSync(CLIENT_ENV_FILE, 0o600);
  console.log(`${role} ${addr} saved to ${CLIENT_ENV_FILE}`);
  if (network.testnet) {
    console.log('Fund ALGO: https://lora.algokit.io/testnet/fund');
    console.log('Get USDC:  https://faucet.circle.com (Algorand Testnet)');
  }
  console.log(`Then run: yarn account optin ${role}`);
}

async function status(role: Role) {
  const { addr } = account(role);
  const info = await algod.accountInformation(addr).do();
  const usdc = info.assets?.find(
    holding => holding.assetId === BigInt(network.asset)
  );
  console.log(
    JSON.stringify({
      role,
      address: addr.toString(),
      network: network.id,
      algo: Number(info.amount) / 1e6,
      usdcOptedIn: Boolean(usdc),
      usdc: usdc ? Number(usdc.amount) / 1e6 : 0
    })
  );
}

async function optIn(role: Role) {
  const { addr, sk } = account(role);
  const info = await algod.accountInformation(addr).do();
  if (info.amount < MIN_ALGO_FOR_OPT_IN) {
    throw new Error(
      `${addr} needs at least 0.201 ALGO to opt in, it has ${Number(info.amount) / 1e6}`
    );
  }
  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: addr,
    receiver: addr,
    amount: 0,
    assetIndex: Number(network.asset),
    suggestedParams: await algod.getTransactionParams().do()
  });
  const { txid } = await algod.sendRawTransaction(txn.signTxn(sk)).do();
  await algosdk.waitForConfirmation(algod, txid, 4);
  console.log(`${role} ${addr} opted in to USDC ${network.asset}: ${txid}`);
}

async function main() {
  const [command = 'status', role] = process.argv.slice(2);
  if (role && !(role in ROLES)) {
    throw new Error(`Role must be one of ${Object.keys(ROLES).join(', ')}`);
  }
  if (command === 'new') return create((role ?? 'buyer') as Role);
  if (command === 'optin') return optIn((role ?? 'buyer') as Role);
  if (command !== 'status') {
    throw new Error('Usage: yarn account [status|new|optin] [buyer|payto]');
  }
  const roles = (role ? [role] : Object.keys(ROLES)) as Role[];
  for (const name of roles.filter(name => process.env[ROLES[name]])) {
    await status(name);
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
