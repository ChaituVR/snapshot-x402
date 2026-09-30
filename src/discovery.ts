import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  examplePath,
  PAID_ROUTES,
  SERVICE_DESCRIPTION,
  SERVICE_NAME
} from './catalog';
import { Config } from './config';
import { escapeHtml } from './html';
import openapiDocument from './openapi.json';

const SOURCE_URL = 'https://github.com/ChaituVR/snapshot-x402';
const VERSION: string = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf8')
).version;
const FREE_PATHS = ['/', '/openapi.json', '/llms.txt', '/healthz'];
const HOW_TO_PAY =
  'Call any /v1 route. You get HTTP 402 with the price. An x402 client (for example @x402/fetch with @x402/avm) pays it in USDC on Algorand and retries for you; the facilitator pays the network fee. Requests that fail before settlement are not charged, and each payment works once.';

function routes(config: Config, origin: string) {
  return PAID_ROUTES.map(route => ({
    method: 'GET',
    path: route.path,
    example: `${origin}${examplePath(route)}`,
    price: config.prices[route.price],
    description: route.description
  }));
}

function payment(config: Config) {
  return {
    protocol: 'x402',
    x402Version: 2,
    scheme: 'exact',
    network: config.network,
    asset: config.asset,
    currency: 'USDC',
    payTo: config.payTo,
    facilitator: config.facilitatorUrl,
    ...(config.base && {
      alternatives: [
        {
          network: config.base.network,
          currency: 'USDC',
          payTo: config.base.payTo
        }
      ]
    })
  };
}

export function serviceInfo(config: Config, origin: string) {
  return {
    name: SERVICE_NAME,
    description: SERVICE_DESCRIPTION,
    version: VERSION,
    testnet: config.testnet,
    payment: { ...payment(config), howTo: HOW_TO_PAY },
    routes: routes(config, origin),
    free: FREE_PATHS,
    links: {
      openapi: `${origin}/openapi.json`,
      llms: `${origin}/llms.txt`,
      snapshot: 'https://snapshot.box',
      x402: 'https://x402.org',
      bazaar: `${config.facilitatorUrl}/discovery/resources`,
      source: SOURCE_URL
    }
  };
}

export function llmsTxt(config: Config, origin: string) {
  const lines = routes(config, origin).map(
    route =>
      `- GET ${origin}${route.path} (${route.price} USDC): ${route.description} Example: ${route.example}`
  );
  return `# ${SERVICE_NAME}

> ${SERVICE_DESCRIPTION}

## How to pay
${HOW_TO_PAY}
Network ${config.network}, USDC asset ${config.asset}, payTo ${config.payTo}, facilitator ${config.facilitatorUrl}.

## Paid routes
${lines.join('\n')}

## Free
- ${origin}/openapi.json: OpenAPI 3.1 with response schemas and examples
- ${origin}/healthz: liveness

## Notes
- Errors are JSON: {"error": {"code", "message"}}.
- Lists return hasMore and next (a relative URL for the next page, or null). Votes also return total.
- Timestamps are unix seconds. Scores and voting power are token amounts, not atomic units.
- Vote choice depends on the proposal type: a 1-based index for single-choice and basic (choiceLabel gives the label), an array of indexes for approval, ranked-choice and copeland, an object of index to weight for weighted and quadratic, and an encrypted string for shutter proposals until they close.
- results.leading is null when there is no score yet or when choices tie.
- Source: ${SOURCE_URL}
`;
}

export function openapi(config: Config, origin: string) {
  const document = structuredClone(openapiDocument) as any;
  document.info.version = VERSION;
  document.servers = [{ url: origin }];
  for (const route of PAID_ROUTES) {
    const operation = document.paths[route.path]?.get;
    if (!operation) continue;
    operation['x-x402'] = {
      ...operation['x-x402'],
      price: config.prices[route.price],
      network: config.network,
      asset: config.asset,
      payTo: config.payTo
    };
    const content = operation.responses?.['200']?.content?.['application/json'];
    if (content) content.example = route.discovery.output?.example;
  }
  return document;
}

export function homeHtml(config: Config, origin: string) {
  const title = `${SERVICE_NAME}: Snapshot governance data, paid per request`;
  const image = `${origin}/og.png`;
  const rows = routes(config, origin)
    .map(
      route =>
        `<tr><td><code>GET ${escapeHtml(route.path)}</code></td><td>${route.price} USDC</td><td>${escapeHtml(route.description)}</td></tr>`
    )
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(SERVICE_DESCRIPTION)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SERVICE_NAME}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(SERVICE_DESCRIPTION)}">
<meta property="og:url" content="${escapeHtml(origin)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
<meta name="theme-color" content="#FF8C00">
<link rel="icon" href="https://snapshot.box/favicon.svg" type="image/svg+xml">
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:860px;margin:0 auto;padding:24px 16px;color:#111;background:#fff}table{border-collapse:collapse;width:100%}td{border-top:1px solid #ddd;padding:8px;vertical-align:top}code,pre{background:#f4f4f4;border-radius:4px;padding:2px 4px}pre{padding:12px;overflow-x:auto}@media(prefers-color-scheme:dark){body{color:#eee;background:#111}code,pre{background:#222}td{border-color:#333}}</style>
</head>
<body>
<h1>${SERVICE_NAME}</h1>
<p>${escapeHtml(SERVICE_DESCRIPTION)}</p>
<h2>Routes</h2>
<table>${rows}</table>
<h2>How to pay</h2>
<p>Call a route and you get HTTP 402 with a <code>PAYMENT-REQUIRED</code> header. Any x402 v2 client signs a USDC payment on Algorand and retries with <code>PAYMENT-SIGNATURE</code>. The <a href="${escapeHtml(config.facilitatorUrl)}">GoPlausible facilitator</a> settles it and pays the network fee. Requests that fail are not settled.</p>
<pre>npm i @x402/fetch @x402/avm algosdk

import { toClientAvmSigner } from '@x402/avm';
import { ExactAvmScheme } from '@x402/avm/exact/client';
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
import algosdk from 'algosdk';

const { sk } = algosdk.mnemonicToSecretKey(process.env.ALGORAND_MNEMONIC);
const signer = toClientAvmSigner(Buffer.from(sk).toString('base64'));
const client = new x402Client().register('algorand:*', new ExactAvmScheme(signer));
const paidFetch = wrapFetchWithPayment(fetch, client);
const space = await (await paidFetch('${escapeHtml(origin)}/v1/spaces/ens.eth')).json();</pre>
<p><a href="/openapi.json">OpenAPI</a> · <a href="/llms.txt">llms.txt</a> · <a href="${SOURCE_URL}">Source</a></p>
</body>
</html>
`;
}
