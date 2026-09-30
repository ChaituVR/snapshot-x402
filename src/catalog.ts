import { DeclareQueryDiscoveryExtensionConfig } from '@x402/extensions/bazaar';
import { PriceKey } from './config';
import examples from './examples.json';

export const SERVICE_NAME = 'Snapshot x402';
export const SERVICE_DESCRIPTION =
  'Pay-per-request Snapshot governance data for AI agents: spaces, proposals with live results, votes and voting power for ENS, Aave, Arbitrum and thousands of DAOs. No API key, no signup: pay each call in USDC on Algorand with x402.';
export const ICON_URL = 'https://avatars.githubusercontent.com/u/72904068?v=4';
export const ROUTE_TAGS = ['snapshot', 'governance', 'dao', 'voting'];

export type PaidRoute = {
  price: PriceKey;
  pattern: string;
  path: string;
  description: string;
  discovery: Omit<DeclareQueryDiscoveryExtensionConfig, 'method'>;
};

const idSchema = (description: string) => ({
  properties: { id: { type: 'string', description } },
  required: ['id']
});

export const PAID_ROUTES: PaidRoute[] = [
  {
    price: 'read',
    pattern: '/v1/spaces/:id',
    path: '/v1/spaces/{id}',
    description:
      'Snapshot DAO space profile: voting strategies, voting settings, admins, delegation portal and activity stats (proposals, votes, followers).',
    discovery: {
      pathParams: { id: 'ens.eth' },
      pathParamsSchema: idSchema('Space id, e.g. ens.eth or aavedao.eth'),
      output: { example: examples.space }
    }
  },
  {
    price: 'read',
    pattern: '/v1/spaces/:id/proposals',
    path: '/v1/spaces/{id}/proposals',
    description:
      'Proposals of a Snapshot DAO space, newest first, with state, choices, live scores, vote count and quorum. Filter by state (active, pending, closed).',
    discovery: {
      pathParams: { id: 'aavedao.eth' },
      pathParamsSchema: idSchema('Space id, e.g. aavedao.eth'),
      input: { state: 'active', first: 20 },
      inputSchema: {
        properties: {
          state: { type: 'string', enum: ['active', 'pending', 'closed'] },
          first: { type: 'integer', minimum: 1, maximum: 100 },
          skip: { type: 'integer', minimum: 0, maximum: 5000 }
        }
      },
      output: { example: examples.proposals }
    }
  },
  {
    price: 'read',
    pattern: '/v1/proposals/:id',
    path: '/v1/proposals/{id}',
    description:
      'One Snapshot governance proposal with per-choice results (score, share, score per strategy), leading choice, quorum, strategies and state. include=body adds the Markdown text.',
    discovery: {
      pathParams: {
        id: '0xcd8d33f6531ed3baa3f728ca8509c66ce7505877b349e6127981e8254adf9a22'
      },
      pathParamsSchema: idSchema('Proposal id: 0x hash or IPFS CID'),
      inputSchema: {
        properties: { include: { type: 'string', enum: ['body'] } }
      },
      output: { example: examples.proposal }
    }
  },
  {
    price: 'read',
    pattern: '/v1/proposals/:id/votes',
    path: '/v1/proposals/{id}/votes',
    description:
      'Votes cast on a Snapshot proposal: voter address, choice, voting power (total and per strategy), reason and time. Sorted by voting power or by time.',
    discovery: {
      pathParams: {
        id: '0xcd8d33f6531ed3baa3f728ca8509c66ce7505877b349e6127981e8254adf9a22'
      },
      pathParamsSchema: idSchema('Proposal id: 0x hash or IPFS CID'),
      input: { first: 100, orderBy: 'vp' },
      inputSchema: {
        properties: {
          first: { type: 'integer', minimum: 1, maximum: 100 },
          skip: { type: 'integer', minimum: 0, maximum: 5000 },
          orderBy: { type: 'string', enum: ['vp', 'created'] }
        }
      },
      output: { example: examples.votes }
    }
  },
  {
    price: 'vp',
    pattern: '/v1/vp',
    path: '/v1/vp',
    description:
      "Voting power of an address in a Snapshot DAO space, per strategy: at a proposal's snapshot block, or right now for the space.",
    discovery: {
      input: {
        voter: '0x3320756d61303284b8012a660ee185c58edd3bb7',
        proposal:
          '0xcd8d33f6531ed3baa3f728ca8509c66ce7505877b349e6127981e8254adf9a22'
      },
      inputSchema: {
        properties: {
          voter: {
            type: 'string',
            pattern: '^0x([0-9a-fA-F]{40}|[0-9a-fA-F]{64})$'
          },
          space: { type: 'string' },
          proposal: { type: 'string' }
        },
        required: ['voter']
      },
      output: { example: examples.vp }
    }
  }
];

export function examplePath(route: PaidRoute): string {
  const params = route.discovery.pathParams ?? {};
  const path = route.pattern.replace(/:(\w+)/g, (_, name: string) =>
    encodeURIComponent(String(params[name]))
  );
  const query = new URLSearchParams(
    Object.entries(route.discovery.input ?? {}).map(
      ([key, value]): [string, string] => [key, String(value)]
    )
  );
  return query.size ? `${path}?${query}` : path;
}
