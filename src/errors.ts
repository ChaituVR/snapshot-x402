import { NextFunction, Request, Response } from 'express';
import { log } from './log';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter?: number
  ) {
    super(message);
  }
}

export const badRequest = (message: string) =>
  new HttpError(400, 'bad_request', message);

export const notFound = (message: string) =>
  new HttpError(404, 'not_found', message);

export function sendError(res: Response, err: HttpError) {
  res.set('Cache-Control', 'no-store');
  if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
  res
    .status(err.status)
    .json({ error: { code: err.code, message: err.message } });
}

export function unknownRoute(req: Request, res: Response) {
  sendError(res, notFound(`No route for ${req.method} ${req.path}`));
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) return sendError(res, err);
  const status = (err as { status?: number }).status;
  if (status === 400 || status === 413) {
    return sendError(
      res,
      new HttpError(status, 'bad_request', 'Malformed request')
    );
  }
  log('http', 'unhandled error', {
    requestId: res.locals.requestId,
    path: req.path,
    error: err instanceof Error ? err.message : String(err)
  });
  sendError(res, new HttpError(500, 'internal_error', 'Internal server error'));
}
