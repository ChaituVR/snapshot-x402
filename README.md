# snapshot-x402

## What this is

An HTTP API for [Snapshot](https://snapshot.box) governance data: spaces, proposals with live results, votes and voting power for ENS, Aave, Arbitrum and other DAOs.
Each call is paid in USDC on Algorand with [x402](https://x402.org) v2. There is no API key or signup, and the [GoPlausible facilitator](https://facilitator.goplausible.xyz) settles each payment and pays the network fee.
It is an entry in the Algorand x402 Global Challenge.

## Pay for a call in 5 minutes

This uses Algorand TestNet, where USDC is free. You need Node 22.13 or newer, Yarn 1 and a clone of this repository. `yarn account new buyer` creates an Algorand account, saves its mnemonic to `.env.client` (gitignored, never read by the server) and prints the address.

```sh
yarn install
yarn account new buyer
```

1. Send the address at least 0.201 ALGO from https://lora.algokit.io/testnet/fund. ALGO only covers the minimum balance and the opt-in fee; the facilitator pays the payment fee.
2. Opt in to TestNet USDC (ASA `10458941`) with `yarn account optin buyer`. Without the opt-in, payments fail with `asset 10458941 missing from <address>`.
3. Get test USDC for the address at https://faucet.circle.com (USDC, Algorand Testnet). `yarn account status buyer` prints the balance.
4. Start a TestNet server on `localhost:3000` as described in [Run it yourself](#run-it-yourself).

Save this as `pay.mjs` in the repository root and run `node pay.mjs`:

```js
import { toClientAvmSigner } from '@x402/avm';
import { ExactAvmScheme } from '@x402/avm/exact/client';
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import algosdk from 'algosdk';

process.loadEnvFile('.env.client');
const { sk } = algosdk.mnemonicToSecretKey(process.env.ALGORAND_BUYER_MNEMONIC);
const signer = toClientAvmSigner(Buffer.from(sk).toString('base64'));
const client = new x402Client()
  .register('algorand:*', new ExactAvmScheme(signer))
  .onAfterPaymentCreation(async ({ selectedRequirements: r }) =>
    console.log(`402: signed ${r.amount} of asset ${r.asset} to ${r.payTo}`)
  );
const paidFetch = wrapFetchWithPayment(fetch, client);

const res = await paidFetch('http://localhost:3000/v1/spaces/ens.eth');
console.log(res.status, await res.json());
const settlement = res.headers.get('payment-response');
if (settlement) {
  const { transaction } = JSON.parse(atob(settlement));
  console.log(`https://facilitator.goplausible.xyz/api/receipt/${transaction}`);
}
```

It prints the 402 it paid (`10000` of asset `10458941`, which is 0.01 USDC), then `200` with the space JSON, then the receipt link `https://facilitator.goplausible.xyz/api/receipt/<txId>`. In another project, `npm i @x402/fetch @x402/avm algosdk` installs the same client. The unpaid call's 402 carries the payment terms in a base64 `PAYMENT-REQUIRED` header; this prints them:

```sh
node -e "fetch('http://localhost:3000/v1/spaces/ens.eth').then(r => console.log(JSON.stringify(JSON.parse(atob(r.headers.get('payment-required'))).accepts[0], null, 2)))"
```

```json
{
  "scheme": "exact",
  "network": "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
  "amount": "10000",
  "asset": "10458941",
  "payTo": "M57WFAJXLE2RO2HL3LNAT5I2FGP2ZJ4DK6HDDAKFNPWKAATTJYFPRACHUE",
  "maxTimeoutSeconds": 300,
  "extra": {
    "tag": "x402-global-challenge",
    "feePayer": "ZMFK2OI7ZBD2U27ISERZC4S6LKM6WMFJPZQ4MYNJDZ2VNBNMBA67RA22AA"
  }
}
```

`amount` is in micro-USDC, `extra.feePayer` is the facilitator account that pays the network fee, and `extra.tag` marks Challenge traffic. The client signs a USDC transfer and retries with a `PAYMENT-SIGNATURE` header. The server verifies it, runs the request and settles only if the response is below 400. The `200` carries a `PAYMENT-RESPONSE` header with the Algorand transaction id.

- Bad input, `404` and upstream errors are not settled, so they cost nothing. An unpaid call to a paid route gets the 402 first, even with bad input.
- Each payment works once. Reusing a `PAYMENT-SIGNATURE` returns `402 payment_rejected` (`duplicate_payment`).
- The one case where a buyer can pay without getting data is a `502 facilitator_error` after the settlement was sent (the facilitator has 45 seconds). The facilitator may still confirm it, and the server logs the payment id and payer so it can be reconciled.
- More than 30 failed paid attempts per minute from one IP address return `429 rate_limited`.

## Endpoints

| Route                                                | Price (USDC) | What you get                                                                                                                 |
| ---------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/spaces/{id}`                                | 0.01         | Space profile: voting strategies, voting settings, admins, delegation portal and activity stats                              |
| `GET /v1/spaces/{id}/proposals?state=&first=&skip=`  | 0.01         | Proposals, newest first, with state, choices, live scores, vote count and quorum. `state` is `active`, `pending` or `closed` |
| `GET /v1/proposals/{id}?include=body`                | 0.01         | One proposal with per-choice results, leading choice, quorum, strategies and state. `include=body` adds the Markdown text    |
| `GET /v1/proposals/{id}/votes?first=&skip=&orderBy=` | 0.01         | Votes: voter, choice, voting power (total and per strategy), reason and time. `orderBy` is `vp` (default) or `created`       |
| `GET /v1/vp?voter=&space=&proposal=`                 | 0.02         | Voting power of `voter` per strategy, at the proposal's snapshot block or now for the space. Needs `space` or `proposal`     |
| `GET /`, `/openapi.json`, `/llms.txt`, `/healthz`    | free         | Service description (HTML, or JSON with `Accept: application/json`), OpenAPI 3.1, plain-text summary, liveness               |

Lists return `hasMore` and `next` (relative URL of the next page, or `null`), and votes also return `total`; `first` is 1 to 100 and `skip` at most 5000. Errors are always `{"error": {"code", "message"}}`.

## Run it yourself

The server needs a receiving account (`payTo`) that has opted in to USDC. On TestNet, create it like the buyer: `yarn account new payto`, fund it, then `yarn account optin payto`. Run `cp .env.example .env` (it already selects TestNet), set `X402_PAY_TO` in `.env` to the payto address (`yarn account status payto` prints it) and start the server:

```sh
yarn dev
```

In a second terminal, `curl -i http://localhost:3000/v1/spaces/ens.eth` answers `HTTP/1.1 402 Payment Required` with the `PAYMENT-REQUIRED` header. The boot log warns if `X402_PAY_TO` has not opted in to USDC. `yarn client` pays every paid route once with the buyer in `.env.client` and prints each receipt link; set `X402_CLIENT_URL` and `X402_CLIENT_NETWORK` (in `.env.client` or the shell) to point it at another server or network.

## Deploy

`fly.toml` and `render.yaml` set `X402_NETWORK` to Algorand MainNet and build the `Dockerfile` (Node 22 Alpine, non-root, health check on `/healthz`). Before the first MainNet payment:

1. Pick the MainNet `payTo` and keep it: the Bazaar listing, dashboard and leaderboard are keyed on it. Fund it with at least 0.201 ALGO and opt it in to USDC ASA `31566704`. The server logs a warning at boot if the opt-in is missing.
2. Pick the final https origin and set it as `PUBLIC_URL`. The server refuses to start on MainNet without it, because the Bazaar lists the origin of the first settled payment and later payments do not change it. With it set, `/v1` answers `421` on any other host and free pages redirect to it.

Fly.io:

```sh
fly launch --no-deploy --copy-config --name snapshot-x402 --region iad
fly secrets set X402_PAY_TO=YOUR_MAINNET_ADDRESS PUBLIC_URL=https://snapshot-x402.fly.dev SNAPSHOT_API_KEY=YOUR_SNAPSHOT_KEY
fly deploy
curl -si https://snapshot-x402.fly.dev/v1/spaces/ens.eth | head -1
```

The last line prints `HTTP/2 402`. For a custom domain, run `fly certs add` with it and use it as `PUBLIC_URL` before the first payment. Then check one paid URL with the x402 Doctor at https://facilitator.goplausible.xyz/guide. The app trusts exactly one proxy hop (`trust proxy: 1`), which is what Fly and Render add; do not put a second proxy in front of it.

Render: New, Blueprint, pick this repository (`render.yaml`), fill in `X402_PAY_TO`, `PUBLIC_URL` and `SNAPSHOT_API_KEY`, then deploy.
The starter plan in `render.yaml` keeps the instance running, so the first 402 is not delayed by a cold start.

## Configuration

| Variable               | Default                                                           | Notes                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                 | `3000`                                                            | `8080` in the `Dockerfile` and `fly.toml`                                                                                    |
| `PUBLIC_URL`           | none                                                              | Required on MainNet. Canonical origin for paid routes, free pages and docs links                                             |
| `SNAPSHOT_API_KEY`     | none                                                              | Sent to the hub and score-api as `x-api-key`. Without it upstream calls are rate limited per IP                              |
| `HUB_URL`              | `https://hub.snapshot.org/graphql`                                |                                                                                                                              |
| `SCORE_API_URL`        | `https://score.snapshot.org`                                      |                                                                                                                              |
| `X402_NETWORK`         | `algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=` (MainNet) | TestNet is `algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=`. USDC is ASA `31566704` on MainNet, `10458941` on TestNet |
| `ALGOD_URL`            | `https://mainnet-api.algonode.cloud`                              | `https://testnet-api.algonode.cloud` on TestNet. Only used to check the `payTo` USDC opt-in at boot                          |
| `X402_PAY_TO`          | required                                                          | Algorand address that receives USDC                                                                                          |
| `X402_FACILITATOR_URL` | `https://facilitator.goplausible.xyz`                             |                                                                                                                              |
| `X402_PRICE_READ`      | `0.01`                                                            | USDC per call on the four read routes, at most 6 decimals                                                                    |
| `X402_PRICE_VP`        | `0.02`                                                            | USDC per call on `/v1/vp`                                                                                                    |
| `X402_TAG`             | `x402-global-challenge`                                           | Sent as `accepts[].extra.tag` and as a resource tag. `none` turns it off                                                     |
| `X402_PAY_TO_EVM`      | none                                                              | Adds Base USDC as a second option (Base mainnet, or Base Sepolia on TestNet)                                                 |

Both default prices are 0.01 USDC or more, which GoPlausible settles with no quota. Prices under 0.01 USDC get 1,000 free settlements per `payTo` per chain per UTC month; after that the facilitator answers `429 subcent_quota_exceeded` until the month ends or Settlement Units are bought ($10 = 25,000 on Algorand). The server logs a warning at boot on MainNet when a price is under 0.01. See https://facilitator.goplausible.xyz/guide/policy.

## Challenge checklist

| Requirement                                  | Where it is met                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Built and tested on TestNet, pays end to end | [Pay for a call in 5 minutes](#pay-for-a-call-in-5-minutes), `yarn client`, and the `TestNet payment` workflow (`.github/workflows/e2e.yml`)                                                                                                                                                                     |
| GoPlausible facilitator                      | `X402_FACILITATOR_URL` default                                                                                                                                                                                                                                                                                   |
| Live on MainNet with a stable `payTo`        | `fly.toml` and `render.yaml` use the MainNet id, `PUBLIC_URL` is required, one `X402_PAY_TO` for all five paid routes                                                                                                                                                                                            |
| Routes tagged `x402-global-challenge`        | `accepts[].extra.tag` on every paid route (`X402_TAG`), shown under SOURCE → X402-GLOBAL-CHALLENGE on https://facilitator.goplausible.xyz/dashboard                                                                                                                                                              |
| Listed in the Bazaar with real settles       | Bazaar and `x402-merchant` extensions on every paid route (`src/x402-routes.ts`), listed at https://facilitator.goplausible.xyz/discovery/resources after the first settled MainNet payment                                                                                                                      |
| First MainNet payment                        | `X402_CLIENT_URL=https://snapshot-x402.fly.dev X402_CLIENT_NETWORK=algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8= yarn client` with a MainNet buyer holding USDC in `.env.client` (0.06 USDC for five calls). Self-funded payments count as synthetic traffic; volume should come from independent buyers |
| Shareable receipt for every settle           | `https://facilitator.goplausible.xyz/api/receipt/<txId>`, printed by `pay.mjs` and `yarn client`                                                                                                                                                                                                                 |

Electric Capital: once this repository is public, open a pull request on https://github.com/electric-capital/open-dev-data that adds the file `migrations/<YYYY-MM-DDThhmmss>_add_snapshot_x402` (UTC time of creation, for example `migrations/2026-10-01T090000_add_snapshot_x402`) containing the line `repadd Algorand https://github.com/ChaituVR/snapshot-x402`, then run `uvx open-dev-data validate` in that repository.

## Development

```sh
yarn lint
yarn typecheck
yarn test
yarn build && yarn start
```

## License

MIT
