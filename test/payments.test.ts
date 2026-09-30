import { PAY_TO } from './helpers';
import { checkPayTo } from '../src/algod';
import { paymentId, PaymentLedger } from '../src/payments';

describe('paymentId', () => {
  it('ignores key order and whitespace', () => {
    expect(paymentId({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(
      paymentId(JSON.parse('{ "b": [1, {"d":3,"c":2}], "a": 1 }'))
    );
  });

  it('differs when the signed data differs', () => {
    expect(paymentId({ paymentGroup: ['A'] })).not.toBe(
      paymentId({ paymentGroup: ['B'] })
    );
  });
});

describe('PaymentLedger', () => {
  afterEach(() => jest.useRealTimers());

  it('lets each payment through once until it expires', () => {
    jest.useFakeTimers({ now: 0 });
    const ledger = new PaymentLedger(1000);

    expect(ledger.claim('a')).toBe(true);
    expect(ledger.claim('a')).toBe(false);
    jest.setSystemTime(1001);
    expect(ledger.claim('a')).toBe(true);
  });

  it('remembers the payer of a claimed payment', () => {
    const ledger = new PaymentLedger(1000);
    ledger.claim('a');
    ledger.setPayer('a', 'BUYER');
    ledger.setPayer('unknown', 'OTHER');

    expect(ledger.payer('a')).toBe('BUYER');
    expect(ledger.payer('unknown')).toBeUndefined();
  });

  it('drops the oldest entry when full', () => {
    const ledger = new PaymentLedger(60e3, 2);
    ledger.claim('a');
    ledger.claim('b');
    ledger.claim('c');

    expect(ledger.claim('b')).toBe(false);
    expect(ledger.claim('a')).toBe(true);
  });
});

describe('checkPayTo', () => {
  const config = {
    algodUrl: 'https://algod.test',
    payTo: PAY_TO,
    asset: '10458941'
  };
  const answer = (status: number) =>
    jest.fn(async () => new Response('{}', { status }));

  it('asks algod for the USDC holding of payTo', async () => {
    const fetchFn = answer(200);

    expect(await checkPayTo(config, fetchFn)).toBe(true);
    expect(fetchFn.mock.calls[0]).toEqual([
      `https://algod.test/v2/accounts/${PAY_TO}/assets/10458941`,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    ]);
  });

  it('reports a missing opt-in and throws on other errors', async () => {
    expect(await checkPayTo(config, answer(404))).toBe(false);
    await expect(checkPayTo(config, answer(500))).rejects.toThrow('HTTP 500');
  });
});
