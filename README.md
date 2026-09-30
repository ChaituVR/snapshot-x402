# snapshot-x402

Pay-per-request [Snapshot](https://snapshot.box) governance data for AI agents, paid in USDC on Algorand with [x402](https://x402.org).

Snapshot is the off-chain voting platform behind ENS, Aave, Arbitrum and thousands of DAOs. This API gives agents, bots and dashboards clean JSON for spaces, proposals with live results, votes and voting power. There is no API key, no signup and no subscription: every call is paid on its own through x402 v2 and settled by the [GoPlausible facilitator](https://facilitator.goplausible.xyz), which also pays the Algorand network fee. The buyer only needs USDC.

## Endpoints

| Route                                                           | Price (USDC) | Returns                                                                   |
| --------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------- |
| `GET /v1/spaces/{id}`                                           | 0.01         | Space profile, strategies, voting settings, activity stats                |
| `GET /v1/spaces/{id}/proposals?state=&first=&skip=`             | 0.01         | Proposals, newest first, with scores (`state`: active, pending, closed)   |
| `GET /v1/proposals/{id}?include=body`                           | 0.01         | Proposal with per-choice results, leading choice, quorum, strategies      |
| `GET /v1/proposals/{id}/votes?first=&skip=&orderBy=vp\|created` | 0.01         | Votes with choice, choice label, voting power per strategy and reason     |
| `GET /v1/vp?voter=&space=&proposal=`                            | 0.02         | Voting power of an address, per strategy                                  |
| `GET /`, `/openapi.json`, `/llms.txt`                           | free         | Service description (HTML, or JSON with `Accept: application/json`), docs |
| `GET /healthz`                                                  | free         | Liveness                                                                  |

Lists return `hasMore` and `next` (relative URL of the next page, or `null`); votes also return `total`. Errors are always `{"error": {"code", "message"}}`. Prices, network and receiving address come from the environment (see [Configuration](#configuration)).

## How to pay

```sh
npm i @x402/fetch @x402/avm algosdk
```

```js
// pay.mjs: ALGORAND_MNEMONIC is a 25-word account holding USDC
import { toClientAvmSigner } from '@x402/avm';
import { ExactAvmScheme } from '@x402/avm/exact/client';
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import algosdk from 'algosdk';

const { sk } = algosdk.mnemonicToSecretKey(process.env.ALGORAND_MNEMONIC);
const signer = toClientAvmSigner(Buffer.from(sk).toString('base64'));
const client = new x402Client().register(
  'algorand:*',
  new ExactAvmScheme(signer)
);
const paidFetch = wrapFetchWithPayment(fetch, client);
const res = await paidFetch('https://<host>/v1/spaces/ens.eth');
console.log(res.status, await res.json());
```

What happens on the wire:

```sh
$ curl -si https://<host>/v1/spaces/ens.eth | grep -i '^payment-required' | cut -d' ' -f2 | tr -d '\r' | base64 -d
```

```json
{
  "x402Version": 2,
  "accepts": [
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
  ]
}
```

1. The unpaid call returns `402` with that base64 `PAYMENT-REQUIRED` header (plus `resource` and the Bazaar extensions). `amount` is micro-USDC and `extra.feePayer` is the facilitator account that pays the fee.
2. The client signs a USDC transfer and retries with `PAYMENT-SIGNATURE`.
3. The server verifies the payment, runs the request, and settles only if the response is below 400. The `200` carries a `PAYMENT-RESPONSE` header with the Algorand transaction id. Receipts: `https://facilitator.goplausible.xyz/api/receipt/<txId>`.

Rules worth knowing:

- Every unpaid request gets the 402 first, even with bad input. Input is validated after the payment is verified; a `400`, `404` or upstream error is not settled, so it is not charged.
- Each payment works once. Reusing a `PAYMENT-SIGNATURE` returns `402 payment_rejected` (`duplicate_payment`).
- The one case where a buyer can pay without getting data is a `502 facilitator_error` after the settlement was submitted: the facilitator may still confirm it. The server logs the payment id and payer so it can be reconciled.
- More than 30 failed paid attempts per minute from one IP address return `429 rate_limited`.

## Run it locally (TestNet)

Requirements: Node 22.13 or newer, Yarn 1.

```sh
yarn install
yarn account new payto       # receiving account, mnemonic saved to .env.client (gitignored)
yarn account new buyer       # paying account
```

1. Fund both addresses with about 0.5 ALGO at https://lora.algokit.io/testnet/fund.
2. Opt both in to TestNet USDC (ASA `10458941`): `yarn account optin payto` and `yarn account optin buyer`. An account that has not opted in cannot receive USDC, and the facilitator rejects the payment in simulation.
3. Get TestNet USDC for the buyer at https://faucet.circle.com (USDC, Algorand Testnet). Check with `yarn account`.
4. `cp .env.example .env`, set `X402_PAY_TO` to the payto address, then `yarn dev`.
5. `yarn client` calls every paid route once, logs each 402, signature and settlement with its receipt link, and exits non-zero if any call did not settle.

`yarn client` reads `.env.client` (`ALGORAND_BUYER_MNEMONIC`, optional `X402_CLIENT_URL` and `X402_CLIENT_NETWORK`); the server never loads it. The `TestNet payment` GitHub workflow runs the same round trip on demand with the `TESTNET_BUYER_MNEMONIC` secret and `TESTNET_PAY_TO` variable.

## Deploy to MainNet

Before the first MainNet payment:

1. Pick the public origin and point the domain at the host. The Bazaar lists the origin of the first settled payment and later payments do not change it, so the domain must be final first. With `PUBLIC_URL` set, `/v1` answers `421` on any other host and free pages redirect there.
2. Give the MainNet `payTo` 0.2 ALGO and opt it in to USDC ASA `31566704`. The server checks this at boot and logs a warning if the opt-in is missing.
3. Decide the price (see [Pricing](#pricing)).

| Variable           | Value                                                            |
| ------------------ | ---------------------------------------------------------------- |
| `X402_NETWORK`     | `algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=`          |
| `X402_PAY_TO`      | MainNet receiving address, opted in to USDC ASA `31566704`       |
| `PUBLIC_URL`       | The public https origin, for example `https://x402.snapshot.box` |
| `SNAPSHOT_API_KEY` | Snapshot API key, sent to the hub and score-api as `x-api-key`   |

Fly.io:

```sh
fly launch --no-deploy --copy-config
fly secrets set X402_PAY_TO=... SNAPSHOT_API_KEY=... PUBLIC_URL=https://x402.snapshot.box
fly certs add x402.snapshot.box
fly deploy
curl -si https://x402.snapshot.box/v1/spaces/ens.eth | head -1   # HTTP/2 402
```

Render: New, Blueprint, pick this repository (`render.yaml`), fill in `X402_PAY_TO`, `SNAPSHOT_API_KEY` and `PUBLIC_URL`, add the custom domain under Settings, then deploy.

Both run the `Dockerfile` (Node 22 Alpine pinned by digest, non-root) and health-check `/healthz`. The app trusts one proxy hop, so the 402 advertises `https://` URLs behind the platform's TLS proxy. Keep the MainNet `payTo` stable: the Bazaar listing, dashboard and leaderboard are keyed on it.

## Pricing

The defaults are 0.01 USDC per read and 0.02 USDC per voting-power call (`X402_PRICE_READ`, `X402_PRICE_VP`). GoPlausible settles MainNet payments of $0.01 or more for free without limit. Payments under $0.01 are free only for the first 1,000 settlements per `payTo`, per chain, per month; after that `/settle` answers `429 subcent_quota_exceeded` until the month ends or Settlement Units are bought ($10 for 25,000 on Algorand). If you lower a price below $0.01 the server logs a warning at boot on MainNet. See https://facilitator.goplausible.xyz/guide/policy.

## Configuration

| Variable               | Default                               | Notes                                                                        |
| ---------------------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| `PORT`                 | `3000`                                |                                                                              |
| `PUBLIC_URL`           | request origin                        | Required on MainNet. Canonical host for 402s, discovery files and redirects  |
| `SNAPSHOT_API_KEY`     | none                                  | Without it the hub limits this server to 100 requests per minute per IP      |
| `HUB_URL`              | `https://hub.snapshot.org/graphql`    |                                                                              |
| `SCORE_API_URL`        | `https://score.snapshot.org`          |                                                                              |
| `X402_NETWORK`         | Algorand MainNet                      | Full genesis-hash id, as listed by the facilitator's `/supported`            |
| `X402_PAY_TO`          | required                              | Algorand address, checked at startup                                         |
| `X402_FACILITATOR_URL` | `https://facilitator.goplausible.xyz` |                                                                              |
| `X402_PRICE_READ`      | `0.01`                                | USDC per call on the four read routes, at most 6 decimals                    |
| `X402_PRICE_VP`        | `0.02`                                | USDC per call on `/v1/vp`                                                    |
| `X402_TAG`             | `x402-global-challenge`               | Sent as `accepts[].extra.tag` and as a resource tag; `none` turns it off     |
| `X402_PAY_TO_EVM`      | none                                  | Adds Base USDC as a second option (Base mainnet, or Base Sepolia on TestNet) |
| `ALGOD_URL`            | AlgoNode for the network              | Used only for the boot check of the `payTo` USDC opt-in                      |

## Discovery

- Each paid route declares the Bazaar extension (input, path parameters, output example) and an `x402-merchant` extension. The first settled payment lists the route in https://facilitator.goplausible.xyz/discovery/resources.
- The facilitator enriches the listing from the API origin: `/` serves HTML with OpenGraph and Twitter tags and a 1200x630 banner at `/og.png`, plus `/llms.txt`.
- Browsers that open a paid URL get a short 402 page that links to the docs.
- Registering an NFD on the MainNet `payTo` gives the listing a verified name and avatar across the facilitator.

## Algorand x402 Global Challenge checklist

| Requirement                                    | Where                                                                                                     |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Build and test on TestNet                      | TestNet steps above, `yarn client`, `TestNet payment` workflow                                            |
| MainNet on public HTTPS                        | `Dockerfile`, `fly.toml`, `render.yaml`, `X402_NETWORK` MainNet id, `PUBLIC_URL`                          |
| GoPlausible facilitator                        | `X402_FACILITATOR_URL` default                                                                            |
| Bazaar discovery                               | `declareDiscoveryExtension` on every route (`src/catalog.ts`, `src/x402-routes.ts`)                       |
| `extra: { tag: 'x402-global-challenge' }`      | `accepts[].extra.tag` on every route (`X402_TAG`)                                                         |
| At least one real MainNet payment              | `X402_CLIENT_URL=https://<host> X402_CLIENT_NETWORK=<MainNet id> yarn client` with a funded MainNet buyer |
| Bazaar and leaderboard presence                | https://facilitator.goplausible.xyz/discovery/resources and `/dashboard/leaderboards`                     |
| Composite entry (several endpoints, one payTo) | Five paid routes, one `X402_PAY_TO`                                                                       |

Payments from wallets the merchant owns or funded count as synthetic traffic. Short tests are fine; volume should come from independent buyers.

Electric Capital: once the repository is public, open a pull request on https://github.com/electric-capital/open-dev-data that adds a migration file `migrations/<YYYY-MM-DDThhmmss>_add_snapshot_x402` containing `repadd Algorand https://github.com/<owner>/snapshot-x402` (confirm the ecosystem name with `uvx open-dev-data export -e Algorand algorand.jsonl`), then run `uvx open-dev-data validate`.

## Development

```sh
yarn lint        # ESLint + Prettier (@snapshot-labs configs)
yarn typecheck
yarn test        # Jest + supertest: facilitator and upstreams mocked, responses checked against openapi.json
yarn build && yarn start
```

Code map: `src/x402.ts` payment middleware, facilitator hooks and error shapes; `src/x402-routes.ts` route prices, Bazaar and paywall config; `src/payments.ts` one-use payment ledger; `src/middleware.ts` request id, method guard, canonical host and failed-payment rate limit; `src/catalog.ts` paid routes and Bazaar metadata; `src/snapshot.ts` hub and score-api clients; `src/routes/` handlers; `src/discovery.ts` free documents; `src/config.ts` environment.

## License

MIT
