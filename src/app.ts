import { FacilitatorClient } from '@x402/core/server';
import cors from 'cors';
import express from 'express';
import { TtlCache } from './cache';
import { Config } from './config';
import { errorHandler, unknownRoute } from './errors';
import {
  canonicalHost,
  failedPaymentLimiter,
  methodGuard,
  requestId
} from './middleware';
import { freeRoutes } from './routes/free';
import { getProposal, listProposalVotes } from './routes/proposals';
import { Deps } from './routes/respond';
import { getSpace, listSpaceProposals } from './routes/spaces';
import { getVotingPower } from './routes/vp';
import { createSnapshot, Snapshot } from './snapshot';
import { createPayment, EXPOSED_HEADERS, Payment } from './x402';

export type AppOptions = {
  facilitator?: FacilitatorClient;
  snapshot?: Snapshot;
  failedPaymentsPerMinute?: number;
};

export function createApp(config: Config, options: AppOptions = {}) {
  const payment: Payment = createPayment(config, options.facilitator);
  const deps: Deps = {
    snapshot: options.snapshot ?? createSnapshot(config),
    cache: new TtlCache<object>()
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.set('etag', false);
  app.use(requestId);
  app.use(
    cors({
      methods: ['GET', 'HEAD'],
      exposedHeaders: [...EXPOSED_HEADERS, 'X-Request-Id', 'Retry-After'],
      maxAge: 86400
    })
  );
  app.use(methodGuard);
  app.use(canonicalHost(config.publicUrl));
  app.use(freeRoutes(config));
  app.use(failedPaymentLimiter(options.failedPaymentsPerMinute));
  app.use(payment.middleware);
  app.get('/v1/spaces/:id', getSpace(deps));
  app.get('/v1/spaces/:id/proposals', listSpaceProposals(deps));
  app.get('/v1/proposals/:id', getProposal(deps));
  app.get('/v1/proposals/:id/votes', listProposalVotes(deps));
  app.get('/v1/vp', getVotingPower(deps));
  app.use(unknownRoute);
  app.use(errorHandler);

  return { app, payment };
}
