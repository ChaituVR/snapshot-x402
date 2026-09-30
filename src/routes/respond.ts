import { Response } from 'express';
import { Loaded, TtlCache } from '../cache';
import { Snapshot } from '../snapshot';

export type Deps = { snapshot: Snapshot; cache: TtlCache<object> };

export async function send(
  res: Response,
  deps: Deps,
  key: string,
  load: () => Promise<Loaded<object>>
) {
  const { value, maxAge } = await deps.cache.get(key, load);
  res.set('Cache-Control', `private, max-age=${maxAge}`).json(value);
}
