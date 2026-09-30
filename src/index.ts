import { existsSync } from 'node:fs';
import { isFatalStartupInitError } from '@x402/core/server';
import { checkPayTo } from './algod';
import { createApp } from './app';
import { isSubcent, loadConfig } from './config';
import { log } from './log';

if (existsSync('.env')) process.loadEnvFile('.env');

const config = loadConfig();
const { app, payment } = createApp(config);

if (!config.snapshotApiKey) {
  log(
    'snapshot',
    'SNAPSHOT_API_KEY is not set, upstream calls are IP rate limited'
  );
}

if (!config.testnet && Object.values(config.prices).some(isSubcent)) {
  log(
    'x402',
    'WARNING: prices under 0.01 USDC use the facilitator free quota of 1,000 settlements per month, then settlements fail until the month ends or Settlement Units are bought',
    { prices: config.prices }
  );
}

payment.initialize().then(
  () => log('x402', 'facilitator ready', { url: config.facilitatorUrl }),
  err => {
    if (isFatalStartupInitError(err)) {
      console.error(err);
      process.exit(1);
    }
    log(
      'x402',
      'facilitator not reachable yet, retrying on first paid request',
      {
        error: err instanceof Error ? err.message : String(err)
      }
    );
  }
);

checkPayTo(config).then(
  isOptedIn => {
    if (isOptedIn) return;
    log(
      'x402',
      'WARNING: X402_PAY_TO is not opted in to USDC, every settlement will fail',
      { payTo: config.payTo, asset: config.asset, network: config.network }
    );
  },
  err =>
    log('x402', 'could not check the X402_PAY_TO USDC opt-in', {
      error: err instanceof Error ? err.message : String(err)
    })
);

const server = app.listen(config.port, err => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  log('http', 'listening', {
    port: config.port,
    publicUrl: config.publicUrl,
    network: config.network,
    payTo: config.payTo,
    prices: config.prices,
    tag: config.tag || null,
    base: config.base?.network ?? null
  });
});

function shutdown(signal: string) {
  log('http', 'shutting down', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10e3).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
