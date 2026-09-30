import { join } from 'node:path';
import { Request, Response, Router } from 'express';
import { Config } from '../config';
import { homeHtml, llmsTxt, openapi, serviceInfo } from '../discovery';

const PUBLIC_CACHE = 'public, max-age=300';
const IMAGE_CACHE = 'public, max-age=86400';
const OG_IMAGE = join(__dirname, '..', '..', 'public', 'og.png');

export function freeRoutes(config: Config) {
  const origin = (req: Request) =>
    config.publicUrl ?? `${req.protocol}://${req.get('host')}`;
  const router = Router();

  router.get('/', (req: Request, res: Response) => {
    res.set('Cache-Control', PUBLIC_CACHE).vary('Accept');
    if (req.accepts(['text/html', 'application/json']) === 'application/json') {
      res.json(serviceInfo(config, origin(req)));
      return;
    }
    res.type('html').send(homeHtml(config, origin(req)));
  });

  router.get('/openapi.json', (req: Request, res: Response) => {
    res.set('Cache-Control', PUBLIC_CACHE).json(openapi(config, origin(req)));
  });

  router.get('/llms.txt', (req: Request, res: Response) => {
    res
      .set('Cache-Control', PUBLIC_CACHE)
      .type('text/plain')
      .send(llmsTxt(config, origin(req)));
  });

  router.get('/og.png', (_req: Request, res: Response) => {
    res.set('Cache-Control', IMAGE_CACHE).sendFile(OG_IMAGE);
  });

  router.get('/healthz', (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store').json({ status: 'ok' });
  });

  return router;
}
