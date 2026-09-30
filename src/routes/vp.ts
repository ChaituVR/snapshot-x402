import { Request, Response } from 'express';
import { badRequest, notFound } from '../errors';
import { strategyRef } from '../format';
import { VP_PROPOSAL, VP_SPACE } from '../queries';
import { Strategy } from '../snapshot';
import { optional, proposalId, spaceId, voter } from '../validate';
import { Deps, send } from './respond';

type VpContext = {
  space: string;
  network: string;
  strategies: Strategy[];
  snapshot: number | 'latest';
};

function toBlock(value: unknown): number | 'latest' {
  const block = Number(value);
  return Number.isSafeInteger(block) && block > 0 ? block : 'latest';
}

async function proposalContext(
  deps: Deps,
  id: string
): Promise<VpContext | null> {
  const { proposal } = await deps.snapshot.query<{ proposal: any }>(
    VP_PROPOSAL,
    { id }
  );
  if (!proposal) return null;
  return {
    space: proposal.space?.id,
    network: proposal.network,
    strategies: proposal.strategies ?? [],
    snapshot: toBlock(proposal.snapshot)
  };
}

async function spaceContext(deps: Deps, id: string): Promise<VpContext | null> {
  const { space } = await deps.snapshot.query<{ space: any }>(VP_SPACE, { id });
  if (!space) return null;
  return {
    space: space.id,
    network: space.network,
    strategies: space.strategies ?? [],
    snapshot: 'latest'
  };
}

export function getVotingPower(deps: Deps) {
  return async (req: Request, res: Response) => {
    const address = voter('voter', req.query.voter);
    const space = optional(req.query.space, value => spaceId('space', value));
    const proposal = optional(req.query.proposal, value =>
      proposalId('proposal', value)
    );
    if (!space && !proposal) throw badRequest('space or proposal is required');

    const key = `vp:${address}:${space ?? ''}:${proposal ?? ''}`;
    await send(res, deps, key, async () => {
      const context = proposal
        ? await proposalContext(deps, proposal)
        : await spaceContext(deps, space as string);
      if (!context) {
        throw notFound(
          proposal
            ? `Proposal ${proposal} not found`
            : `Space ${space} not found`
        );
      }
      if (space && context.space !== space) {
        throw badRequest(
          `Proposal ${proposal} belongs to space ${context.space}, not ${space}`
        );
      }
      const result = await deps.snapshot.getVp({
        address,
        network: context.network,
        strategies: context.strategies,
        snapshot: context.snapshot,
        space: context.space
      });
      return {
        value: {
          voter: address,
          space: context.space,
          proposal: proposal ?? null,
          network: context.network,
          snapshot: context.snapshot,
          vp: result.vp,
          vpState: result.vp_state,
          vpByStrategy: context.strategies.map((strategy, index) => ({
            ...strategyRef(strategy),
            vp: result.vp_by_strategy?.[index] ?? 0
          }))
        },
        ttl: result.vp_state === 'final' ? 86400 : 60
      };
    });
  };
}
