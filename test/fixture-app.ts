import request from 'supertest';
import { createApp } from '../src/app';
import { createSnapshot } from '../src/snapshot';
import getVp from './fixtures/get-vp.json';
import proposal from './fixtures/proposal.json';
import proposals from './fixtures/proposals.json';
import space from './fixtures/space.json';
import votes from './fixtures/votes.json';
import vpProposal from './fixtures/vp-proposal.json';
import {
  fakeFacilitator,
  mockFetch,
  operation,
  paymentFor,
  testConfig,
  Upstream,
  UpstreamCall
} from './helpers';

export const PROPOSAL_ID =
  '0xcd8d33f6531ed3baa3f728ca8509c66ce7505877b349e6127981e8254adf9a22';
export const VOTER = '0x3320756d61303284B8012A660Ee185C58EDd3BB7';

const RESPONSES: Record<string, unknown> = {
  Space: space,
  SpaceProposals: proposals,
  Proposal: proposal,
  ProposalVotes: votes,
  VpProposal: vpProposal,
  VpSpace: { data: { space: space.data.space } },
  get_vp: getVp
};

export function fixtureApp(
  handler?: (call: UpstreamCall) => Upstream | undefined
) {
  const fetchFn = mockFetch(
    call => handler?.(call) ?? { body: RESPONSES[operation(call)] }
  );
  const config = testConfig();
  const facilitator = fakeFacilitator();
  const { app } = createApp(config, {
    facilitator,
    snapshot: createSnapshot(config, fetchFn)
  });
  const paid = async (path: string) => {
    const unpaid = await request(app).get(path);
    return request(app).get(path).set('PAYMENT-SIGNATURE', paymentFor(unpaid));
  };
  return { app, paid, fetchFn, facilitator };
}
