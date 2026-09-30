import { FacilitatorClient } from '@x402/core/server';
import {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse
} from '@x402/core/types';
import { Response as TestResponse } from 'supertest';
import { ALGORAND_TESTNET, Config, loadConfig } from '../src/config';
import supported from './fixtures/supported.json';

export const PAY_TO =
  'M57WFAJXLE2RO2HL3LNAT5I2FGP2ZJ4DK6HDDAKFNPWKAATTJYFPRACHUE';
export const BUYER =
  'CI46O22TTLIC2SCPJUZT56I6ITBBQN4MLMY3KV2AVVATSUJPLHRBKOSRJQ';
export const TX_ID = 'SY2UCSENTESTTRANSACTIONID0000000000000000000000000000';

export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({
    X402_NETWORK: ALGORAND_TESTNET,
    X402_PAY_TO: PAY_TO,
    SNAPSHOT_API_KEY: 'test-key',
    ...env
  });
}

export type FakeFacilitator = FacilitatorClient & {
  verify: jest.Mock<
    Promise<VerifyResponse>,
    [PaymentPayload, PaymentRequirements]
  >;
  settle: jest.Mock<
    Promise<SettleResponse>,
    [PaymentPayload, PaymentRequirements]
  >;
};

export function fakeFacilitator(): FakeFacilitator {
  return {
    getSupported: async () => supported as SupportedResponse,
    verify: jest.fn<
      Promise<VerifyResponse>,
      [PaymentPayload, PaymentRequirements]
    >(async () => ({ isValid: true, payer: BUYER })),
    settle: jest.fn<
      Promise<SettleResponse>,
      [PaymentPayload, PaymentRequirements]
    >(async (_payload, requirements) => ({
      success: true,
      transaction: TX_ID,
      network: requirements.network,
      payer: BUYER
    }))
  };
}

export function decodeHeader<T = PaymentRequired>(value: string): T {
  return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
}

let payments = 0;

export function paymentFor(res: TestResponse, index = 0): string {
  const required = decodeHeader(res.headers['payment-required']);
  payments += 1;
  const payload = {
    x402Version: 2,
    resource: required.resource,
    accepted: required.accepts[index],
    extensions: required.extensions,
    payload: { paymentGroup: ['AAAA', `BBBB${payments}`], paymentIndex: 1 }
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

export type Upstream = {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
};

export type UpstreamCall = { url: string; body: any; headers: Headers };

export function mockFetch(
  handler: (call: UpstreamCall) => Upstream | Promise<Upstream>
) {
  return jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const call = {
      url: String(input),
      body: JSON.parse(String(init?.body)),
      headers: new Headers(init?.headers)
    };
    const result = await handler(call);
    return new Response(
      typeof result.body === 'string'
        ? result.body
        : JSON.stringify(result.body),
      {
        status: result.status ?? 200,
        headers: { 'content-type': 'application/json', ...result.headers }
      }
    );
  });
}

export const operation = (call: UpstreamCall) =>
  /^query (\w+)/.exec(call.body.query ?? '')?.[1] ?? call.body.method;
