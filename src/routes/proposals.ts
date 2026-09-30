import { Request, Response } from 'express';
import { notFound } from '../errors';
import { choiceLabels, formatProposal, formatVote, orNull } from '../format';
import { PROPOSAL, PROPOSAL_VOTES } from '../queries';
import { integer, oneOf, proposalId } from '../validate';
import { MAX_SKIP, page } from './page';
import { Deps, send } from './respond';

const ORDER_BY = ['vp', 'created'] as const;

const isFinal = (proposal: { state?: string; scores_state?: string }) =>
  proposal.state === 'closed' && proposal.scores_state === 'final';

function proposalTtl(proposal: { state?: string; scores_state?: string }) {
  if (isFinal(proposal)) return 3600;
  return proposal.state === 'active' ? 30 : 60;
}

export function getProposal(deps: Deps) {
  return async (req: Request, res: Response) => {
    const id = proposalId('id', req.params.id);
    const withBody = oneOf('include', req.query.include, ['body']) === 'body';
    await send(res, deps, `proposal:${id}:${withBody}`, async () => {
      const { proposal } = await deps.snapshot.query<{ proposal: any }>(
        PROPOSAL,
        { id, withBody }
      );
      if (!proposal) throw notFound(`Proposal ${id} not found`);
      return { value: formatProposal(proposal), ttl: proposalTtl(proposal) };
    });
  };
}

export function listProposalVotes(deps: Deps) {
  return async (req: Request, res: Response) => {
    const id = proposalId('id', req.params.id);
    const first = integer('first', req.query.first, {
      min: 1,
      max: 100,
      fallback: 100
    });
    const skip = integer('skip', req.query.skip, {
      min: 0,
      max: MAX_SKIP,
      fallback: 0
    });
    const orderBy = oneOf('orderBy', req.query.orderBy, ORDER_BY) ?? 'vp';
    const key = `votes:${id}:${first}:${skip}:${orderBy}`;
    await send(res, deps, key, async () => {
      const data = await deps.snapshot.query<{ proposal: any; votes: any[] }>(
        PROPOSAL_VOTES,
        { id, first, skip, orderBy }
      );
      const { proposal } = data;
      if (!proposal) throw notFound(`Proposal ${id} not found`);
      const labels = choiceLabels(proposal);
      const items = (data.votes ?? []).map(vote => formatVote(vote, labels));
      const total: number = proposal.votes ?? 0;
      const pagination = page({
        path: `/v1/proposals/${id}/votes`,
        query: { orderBy },
        first,
        skip,
        count: items.length,
        total
      });
      return {
        value: {
          proposal: {
            id: proposal.id,
            space: proposal.space?.id ?? null,
            state: proposal.state,
            type: orNull(proposal.type),
            privacy: orNull(proposal.privacy),
            choices: proposal.choices ?? []
          },
          orderBy,
          first,
          skip,
          total,
          ...pagination,
          items
        },
        ttl: isFinal(proposal) ? 3600 : 30
      };
    });
  };
}
