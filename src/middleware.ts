import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { HttpError, sendError } from './errors';
import { log } from './log';

const REQUEST_ID = /^[\w.-]{1,64}$/;
const PAID_PATH = /^\/v1(\/|$)/i;
const FAILED_PAYMENTS_PER_MINUTE = 30;

const isPaidPath = (req: Request) => PAID_PATH.test(req.path);

export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.get('x-request-id');
  const id = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  req.headers['x-request-id'] = id;
  res.locals.requestId = id;
  res.set('X-Request-Id', id);
  const started = Date.now();
  res.on('finish', () => {
    log('http', `${req.method} ${req.originalUrl} ${res.statusCode}`, {
      ms: Date.now() - started,
      requestId: id
    });
  });
  next();
}

export function methodGuard(req: Request, res: Response, next: NextFunction) {
  const isPaid = isPaidPath(req);
  if (req.method === 'GET' || (req.method === 'HEAD' && !isPaid)) return next();
  res.set('Allow', isPaid ? 'GET' : 'GET, HEAD');
  sendError(
    res,
    new HttpError(
      405,
      'method_not_allowed',
      `${req.method} is not allowed here`
    )
  );
}

export function canonicalHost(publicUrl: string | null) {
  const host = publicUrl ? new URL(publicUrl).host : null;
  return (req: Request, res: Response, next: NextFunction) => {
    if (!publicUrl || req.path === '/healthz') return next();
    if (req.headers.host?.toLowerCase() === host) return next();
    const target = `${publicUrl}${req.originalUrl}`;
    if (!isPaidPath(req)) return res.redirect(308, target);
    sendError(res, new HttpError(421, 'misdirected_request', `Use ${target}`));
  };
}

export function failedPaymentLimiter(limit = FAILED_PAYMENTS_PER_MINUTE) {
  return rateLimit({
    windowMs: 60e3,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    skip: req => !isPaidPath(req) || !req.get('payment-signature'),
    handler: (req, res) => {
      log('x402', 'failed payment rate limit', {
        ip: req.ip,
        requestId: res.locals.requestId
      });
      sendError(
        res,
        new HttpError(
          429,
          'rate_limited',
          'Too many failed payments from this address, retry later'
        )
      );
    }
  });
}
