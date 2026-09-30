import { toClientAvmSigner } from '@x402/avm';
import { ExactAvmScheme } from '@x402/avm/exact/client';
import {
  decodePaymentResponseHeader,
  wrapFetchWithPayment,
  x402Client
} from '@x402/fetch';
import algosdk from 'algosdk';
import { loadEnvFiles } from './env';

loadEnvFiles();

const BASE_URL = (
  process.env.X402_CLIENT_URL || `http://localhost:${process.env.PORT || 3000}`
).replace(/\/+$/, '');
const FACILITATOR_URL =
  process.env.X402_FACILITATOR_URL || 'https://facilitator.goplausible.xyz';
const PROPOSAL =
  '0xcd8d33f6531ed3baa3f728ca8509c66ce7505877b349e6127981e8254adf9a22';
const VOTER = '0x3320756d61303284b8012a660ee185c58edd3bb7';

const PATHS = [
  '/v1/spaces/ens.eth',
  '/v1/spaces/aavedao.eth/proposals?state=closed&first=3',
  `/v1/proposals/${PROPOSAL}`,
  `/v1/proposals/${PROPOSAL}/votes?first=3`,
  `/v1/vp?voter=${VOTER}&proposal=${PROPOSAL}`
];

function decode(header: string | null) {
  return header ? JSON.parse(Buffer.from(header, 'base64').toString()) : null;
}

async function call(paidFetch: typeof fetch, path: string): Promise<boolean> {
  const res = await paidFetch(`${BASE_URL}${path}`);
  const body = await res.text();
  const receipt = res.headers.get('payment-response');
  console.log(`\nGET ${path} -> ${res.status}`);
  if (receipt && res.ok) {
    const settle = decodePaymentResponseHeader(receipt);
    console.log('settled', {
      transaction: settle.transaction,
      network: settle.network,
      payer: settle.payer,
      receipt: `${FACILITATOR_URL}/api/receipt/${settle.transaction}`
    });
    console.log('data', body.slice(0, 300));
    return true;
  }
  const required = decode(res.headers.get('payment-required'));
  console.log('rejected', required?.error ?? body.slice(0, 300));
  return false;
}

async function main() {
  const mnemonic = process.env.ALGORAND_BUYER_MNEMONIC?.trim();
  if (!mnemonic) {
    throw new Error(
      'Set ALGORAND_BUYER_MNEMONIC in .env.client (yarn account new) to a funded buyer'
    );
  }
  const { sk } = algosdk.mnemonicToSecretKey(mnemonic);
  const signer = toClientAvmSigner(Buffer.from(sk).toString('base64'));
  const client = new x402Client()
    .register('algorand:*', new ExactAvmScheme(signer))
    .onAfterPaymentCreation(
      async ({ selectedRequirements, paymentRequired }) => {
        console.log('402 -> signed', {
          resource: paymentRequired.resource.url,
          network: selectedRequirements.network,
          amount: selectedRequirements.amount,
          asset: selectedRequirements.asset,
          payTo: selectedRequirements.payTo,
          tag: selectedRequirements.extra?.tag
        });
      }
    );
  const paidFetch = wrapFetchWithPayment(fetch, client);

  console.log('buyer', signer.address, 'server', BASE_URL);
  let failures = 0;
  for (const path of PATHS) {
    try {
      if (!(await call(paidFetch, path))) failures++;
    } catch (err) {
      failures++;
      console.log(
        `\nGET ${path} failed`,
        err instanceof Error ? err.message : err
      );
    }
  }
  console.log(
    `\n${PATHS.length - failures}/${PATHS.length} paid calls settled`
  );
  if (failures) process.exit(1);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
