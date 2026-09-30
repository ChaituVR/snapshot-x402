import { RouteConfig, RoutesConfig } from '@x402/core/server';
import { declareDiscoveryExtension } from '@x402/extensions/bazaar';
import {
  ICON_URL,
  PAID_ROUTES,
  PaidRoute,
  ROUTE_TAGS,
  SERVICE_NAME
} from './catalog';
import { Config } from './config';
import { escapeHtml } from './html';

const JSON_TYPE = 'application/json';

function merchantExtension(config: Config) {
  return {
    info: {
      name: SERVICE_NAME,
      ...(config.publicUrl && { website: config.publicUrl }),
      logo: ICON_URL,
      categories: ['governance', 'dao', 'data', 'snapshot']
    },
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        website: { type: 'string' },
        logo: { type: 'string' },
        categories: { type: 'array', items: { type: 'string' } }
      }
    }
  };
}

function accepts(config: Config, price: string) {
  const extra = config.tag ? { tag: config.tag } : undefined;
  const options = [
    {
      scheme: 'exact',
      network: config.network,
      price: `$${price}`,
      payTo: config.payTo,
      ...(extra && { extra })
    }
  ];
  if (config.base) {
    options.push({
      scheme: 'exact',
      network: config.base.network,
      price: `$${price}`,
      payTo: config.base.payTo,
      ...(extra && { extra })
    });
  }
  return options;
}

function paywallHtml(route: PaidRoute, price: string, docs: string) {
  const title = `${SERVICE_NAME}: payment required`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:640px;margin:0 auto;padding:24px 16px;color:#111;background:#fff}code{background:#f4f4f4;border-radius:4px;padding:2px 4px}@media(prefers-color-scheme:dark){body{color:#eee;background:#111}code{background:#222}}</style>
</head>
<body>
<h1>HTTP 402: payment required</h1>
<p><code>GET ${escapeHtml(route.path)}</code> is a paid API route for agents: ${escapeHtml(price)} USDC per request on Algorand, paid with the x402 protocol.</p>
<p>${escapeHtml(route.description)}</p>
<p>Call it with an x402 client such as <code>@x402/fetch</code> with <code>@x402/avm</code>. The payment details are in the base64 <code>PAYMENT-REQUIRED</code> response header.</p>
<p><a href="${escapeHtml(docs)}">How to pay</a> · <a href="${escapeHtml(docs)}openapi.json">OpenAPI</a> · <a href="${escapeHtml(docs)}llms.txt">llms.txt</a></p>
</body>
</html>
`;
}

function routeConfig(config: Config, route: PaidRoute): RouteConfig {
  const price = config.prices[route.price];
  const tags = config.tag ? [config.tag, ...ROUTE_TAGS] : ROUTE_TAGS;
  const docs = config.publicUrl ? `${config.publicUrl}/` : '/';
  return {
    accepts: accepts(config, price),
    description: route.description,
    mimeType: JSON_TYPE,
    serviceName: SERVICE_NAME,
    tags: tags.slice(0, 5),
    iconUrl: ICON_URL,
    customPaywallHtml: paywallHtml(route, price, docs),
    unpaidResponseBody: () => ({
      contentType: JSON_TYPE,
      body: {
        error: {
          code: 'payment_required',
          message: `This route costs ${price} USDC per call, paid with x402. Any x402 client (for example @x402/fetch with @x402/avm) pays it for you.`
        },
        docs
      }
    }),
    settlementFailedResponseBody: (_context, result) => ({
      contentType: JSON_TYPE,
      body: {
        error: {
          code: 'settlement_failed',
          message: `The payment was not settled (${result.errorReason}), so the data was withheld. Sign a new payment and retry.`
        },
        docs
      }
    }),
    extensions: {
      ...declareDiscoveryExtension(route.discovery),
      'x402-merchant': merchantExtension(config)
    }
  };
}

export function buildRoutes(config: Config): RoutesConfig {
  return Object.fromEntries(
    PAID_ROUTES.map(route => [
      `GET ${route.pattern}`,
      routeConfig(config, route)
    ])
  );
}
