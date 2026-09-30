import { Request, Response } from 'express';
import { notFound } from '../errors';
import { formatProposalSummary, formatSpace } from '../format';
import { SPACE, SPACE_PROPOSALS } from '../queries';
import { integer, oneOf, spaceId } from '../validate';
import { MAX_SKIP, page } from './page';
import { Deps, send } from './respond';

const STATES = ['active', 'pending', 'closed'] as const;

export function getSpace(deps: Deps) {
  return async (req: Request, res: Response) => {
    const id = spaceId('id', req.params.id);
    await send(res, deps, `space:${id}`, async () => {
      const { space } = await deps.snapshot.query<{ space: any }>(SPACE, {
        id
      });
      if (!space) throw notFound(`Space ${id} not found`);
      return { value: formatSpace(space), ttl: 300 };
    });
  };
}

export function listSpaceProposals(deps: Deps) {
  return async (req: Request, res: Response) => {
    const space = spaceId('id', req.params.id);
    const state = oneOf('state', req.query.state, STATES) ?? null;
    const first = integer('first', req.query.first, {
      min: 1,
      max: 100,
      fallback: 20
    });
    const skip = integer('skip', req.query.skip, {
      min: 0,
      max: MAX_SKIP,
      fallback: 0
    });
    const key = `proposals:${space}:${state}:${first}:${skip}`;
    await send(res, deps, key, async () => {
      const data = await deps.snapshot.query<{ space: any; proposals: any[] }>(
        SPACE_PROPOSALS,
        { space, first, skip, where: state ? { space, state } : { space } }
      );
      if (!data.space) throw notFound(`Space ${space} not found`);
      const items = (data.proposals ?? []).map(formatProposalSummary);
      const pagination = page({
        path: `/v1/spaces/${encodeURIComponent(space)}/proposals`,
        query: { state },
        first,
        skip,
        count: items.length
      });
      return {
        value: { space, state, first, skip, ...pagination, items },
        ttl: state === 'active' ? 30 : 60
      };
    });
  };
}
