import { ExactAvmScheme } from '@x402/avm/exact/server';
import {
  decodePaymentRequiredHeader,
  decodePaymentSignatureHeader
} from '@x402/core/http';
import {
  FacilitatorClient,
  HTTPFacilitatorClient,
  HTTPTransportContext
} from '@x402/core/server';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import {
  ExpressAdapter,
  paymentMiddlewareFromHTTPServer,
  x402HTTPResourceServer,
  x402ResourceServer
} from '@x402/express';
import { bazaarResourceServerExtension } from '@x402/extensions/bazaar';
import { NextFunction, Request, Response } from 'express';
import { PAID_ROUTES } from './catalog';
import { Config } from './config';
import { HttpError, sendError } from './errors';
import { log } from './log';
import { paymentId, PaymentLedger } from './payments';
import { buildRoutes } from './x402-routes';

export const EXPOSED_HEADERS = ['PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'];

const FACILITATOR_TIMEOUT_MS = 45e3;
const PAYMENT_TTL_MS = 300e3;

const ROUTE_MATCHERS = PAID_ROUTES.map(route => ({
  name: `GET ${route.pattern}`,
  regex: new RegExp(`^${route.pattern.replace(/:\w+/g, '[^/]+')}/?$`, 'i')
}));

type LibraryError = { error?: unknown };

function describe(transportContext: unknown, payload?: unknown) {
  const request = (transportContext as HTTPTransportContext | undefined)
    ?.request;
  const path = request?.path ?? '';
  return {
    route: ROUTE_MATCHERS.find(matcher => matcher.regex.test(path))?.name,
    path: request?.path,
    requestId: request?.adapter.getHeader('x-request-id'),
    ...(payload !== undefined && { paymentId: paymentId(payload) })
  };
}

function decodedPath(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function paymentReason(res: Response) {
  const header = res.getHeader('PAYMENT-REQUIRED');
  if (typeof header !== 'string') return null;
  try {
    return decodePaymentRequiredHeader(header).error ?? null;
  } catch {
    return null;
  }
}

function libraryErrorBody(res: Response, body: unknown) {
  const error = (body as LibraryError | null | undefined)?.error;
  if (res.statusCode === 502 && typeof error === 'string') {
    return { code: 'facilitator_error', message: error };
  }
  if (res.statusCode === 500 && typeof error === 'string') {
    return { code: 'internal_error', message: 'Internal server error' };
  }
  const isEmpty =
    body !== null && typeof body === 'object' && !Object.keys(body).length;
  if (res.statusCode === 402 && isEmpty) {
    const reason = paymentReason(res);
    return reason
      ? { code: 'payment_rejected', message: reason }
      : { code: 'settlement_failed', message: 'The payment was not settled' };
  }
  return null;
}

function normalizeLibraryErrors(res: Response) {
  const json = res.json.bind(res);
  res.json = (body?: unknown) => {
    const error = libraryErrorBody(res, body);
    if (!error) return json(body);
    res.set('Cache-Control', 'no-store');
    return json({ error });
  };
}

function dropUnreadablePayment(req: Request) {
  const header = req.headers['payment-signature'];
  if (typeof header !== 'string') return;
  try {
    decodePaymentSignatureHeader(header);
  } catch {
    delete req.headers['payment-signature'];
    log('x402', 'unreadable payment header', {
      path: req.path,
      requestId: req.get('x-request-id'),
      bytes: header.length
    });
  }
}

function createResourceServer(
  config: Config,
  facilitator: FacilitatorClient,
  ledger: PaymentLedger
) {
  const server = new x402ResourceServer(facilitator)
    .register('algorand:*', new ExactAvmScheme())
    .registerExtension(bazaarResourceServerExtension);
  if (config.base) server.register(config.base.network, new ExactEvmScheme());

  return server
    .onBeforeVerify(async ({ paymentPayload, transportContext }) => {
      if (ledger.claim(paymentId(paymentPayload.payload))) return;
      log('x402', 'duplicate payment', {
        ...describe(transportContext, paymentPayload.payload)
      });
      return {
        abort: true,
        reason: 'duplicate_payment',
        message: 'This payment was already used, sign a new one'
      };
    })
    .onAfterVerify(async ({ paymentPayload, result, transportContext }) => {
      const id = paymentId(paymentPayload.payload);
      ledger.setPayer(id, result.payer);
      if (result.isValid) return;
      log('x402', 'verify rejected', {
        ...describe(transportContext, paymentPayload.payload),
        reason: result.invalidReason,
        payer: result.payer
      });
    })
    .onVerifyFailure(async ({ error, paymentPayload, transportContext }) => {
      log('x402', 'verify failed', {
        ...describe(transportContext, paymentPayload.payload),
        error: error.message
      });
    })
    .onAfterSettle(
      async ({ paymentPayload, result, requirements, transportContext }) => {
        log('x402', 'paid', {
          ...describe(transportContext, paymentPayload.payload),
          network: result.network,
          amount: requirements.amount,
          asset: requirements.asset,
          transaction: result.transaction,
          payer: result.payer
        });
      }
    )
    .onSettleFailure(async ({ error, paymentPayload, transportContext }) => {
      log('x402', 'settle failed', {
        ...describe(transportContext, paymentPayload.payload),
        payer: ledger.payer(paymentId(paymentPayload.payload)),
        error: error.message
      });
    })
    .onVerifiedPaymentCanceled(
      async ({ reason, responseStatus, paymentPayload, transportContext }) => {
        log('x402', 'not charged', {
          ...describe(transportContext, paymentPayload.payload),
          reason,
          status: responseStatus
        });
      }
    );
}

export type Payment = {
  middleware: (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<void>;
  initialize: () => Promise<void>;
};

export function createPayment(
  config: Config,
  facilitator: FacilitatorClient = new HTTPFacilitatorClient({
    url: config.facilitatorUrl,
    timeoutMs: FACILITATOR_TIMEOUT_MS
  })
): Payment {
  const httpServer = new x402HTTPResourceServer(
    createResourceServer(
      config,
      facilitator,
      new PaymentLedger(PAYMENT_TTL_MS)
    ),
    buildRoutes(config)
  );
  const payment = paymentMiddlewareFromHTTPServer(
    httpServer,
    undefined,
    undefined,
    false
  );

  let initialization: Promise<void> | null = null;
  const initialize = () => {
    initialization ??= httpServer.initialize().catch(err => {
      initialization = null;
      throw err;
    });
    return initialization;
  };

  const middleware = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    const context = {
      adapter: new ExpressAdapter(req),
      path: req.path,
      decodedPath: decodedPath(req.path),
      method: req.method
    };
    if (!httpServer.requiresPayment(context)) return next();
    try {
      await initialize();
    } catch (err) {
      log('x402', 'facilitator init failed', {
        error: err instanceof Error ? err.message : String(err)
      });
      return sendError(
        res,
        new HttpError(
          503,
          'facilitator_unavailable',
          'Payment facilitator is unavailable, retry later',
          30
        )
      );
    }
    dropUnreadablePayment(req);
    normalizeLibraryErrors(res);
    return payment(req, res, next);
  };

  return { middleware, initialize };
}
