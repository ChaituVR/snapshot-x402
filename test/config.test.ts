import { PAY_TO } from './helpers';
import {
  ALGORAND_MAINNET,
  ALGORAND_TESTNET,
  DEFAULT_FACILITATOR_URL,
  isSubcent,
  loadConfig
} from '../src/config';

const PUBLIC_URL = 'https://x402.example.com';

const load = (env: Record<string, string> = {}) =>
  loadConfig({ X402_PAY_TO: PAY_TO, PUBLIC_URL, ...env });

describe('loadConfig', () => {
  it('defaults to Algorand MainNet USDC through GoPlausible', () => {
    expect(load()).toMatchObject({
      network: ALGORAND_MAINNET,
      testnet: false,
      asset: '31566704',
      algodUrl: 'https://mainnet-api.algonode.cloud',
      facilitatorUrl: DEFAULT_FACILITATOR_URL,
      prices: { read: '0.01', vp: '0.02' },
      tag: 'x402-global-challenge',
      base: null,
      port: 3000
    });
  });

  it('switches asset and algod on TestNet', () => {
    expect(load({ X402_NETWORK: ALGORAND_TESTNET })).toMatchObject({
      testnet: true,
      asset: '10458941',
      algodUrl: 'https://testnet-api.algonode.cloud'
    });
  });

  it('requires PUBLIC_URL on MainNet only', () => {
    expect(() => loadConfig({ X402_PAY_TO: PAY_TO })).toThrow('PUBLIC_URL');
    expect(
      loadConfig({ X402_PAY_TO: PAY_TO, X402_NETWORK: ALGORAND_TESTNET })
        .publicUrl
    ).toBeNull();
  });

  it('rejects the truncated network id that the facilitator does not list', () => {
    expect(() =>
      load({ X402_NETWORK: 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe' })
    ).toThrow('X402_NETWORK');
  });

  it.each(['', 'not-an-address', '0x000000000000000000000000000000000000dEaD'])(
    'rejects payTo "%s"',
    payTo => {
      expect(() => load({ X402_PAY_TO: payTo })).toThrow('X402_PAY_TO');
    }
  );

  it('never echoes a rejected address, which could be a pasted mnemonic', () => {
    const secret = 'abandon abandon abandon abandon';
    const error = (env: Record<string, string>) => {
      try {
        load(env);
      } catch (err) {
        return (err as Error).message;
      }
      return '';
    };

    expect(error({ X402_PAY_TO: secret })).not.toContain('abandon');
    expect(error({ X402_PAY_TO_EVM: secret })).not.toContain('abandon');
    expect(error({ X402_PAY_TO: secret })).toContain('31 character');
  });

  it.each(['0', '0.0000001', 'abc', '-1', '1e-3', '$'])(
    'rejects price "%s"',
    price => {
      expect(() => load({ X402_PRICE_READ: price })).toThrow('X402_PRICE_READ');
    }
  );

  it('accepts dollar prices', () => {
    expect(
      load({ X402_PRICE_READ: '$0.005', X402_PRICE_VP: '0.05' }).prices
    ).toEqual({ read: '0.005', vp: '0.05' });
  });

  it('adds Base on the matching EVM network', () => {
    const evm = '0x000000000000000000000000000000000000dEaD';
    expect(load({ X402_PAY_TO_EVM: evm }).base).toEqual({
      network: 'eip155:8453',
      payTo: evm
    });
    expect(
      load({ X402_NETWORK: ALGORAND_TESTNET, X402_PAY_TO_EVM: evm }).base
        ?.network
    ).toBe('eip155:84532');
    expect(() => load({ X402_PAY_TO_EVM: PAY_TO })).toThrow('X402_PAY_TO_EVM');
  });

  it('keeps the challenge tag unless it is set to none', () => {
    expect(load({ X402_TAG: '' }).tag).toBe('x402-global-challenge');
    expect(load({ X402_TAG: '   ' }).tag).toBe('x402-global-challenge');
    expect(load({ X402_TAG: 'none' }).tag).toBe('');
    expect(load({ X402_TAG: 'other-tag' }).tag).toBe('other-tag');
    expect(() => load({ X402_TAG: 'has spaces' })).toThrow('X402_TAG');
  });

  it('validates URLs and port', () => {
    expect(load({ PUBLIC_URL: 'https://x402.example.com/' }).publicUrl).toBe(
      'https://x402.example.com'
    );
    expect(() => load({ PUBLIC_URL: 'ftp://x' })).toThrow('PUBLIC_URL');
    expect(() => load({ PORT: '70000' })).toThrow('PORT');
  });

  it('flags prices under one cent', () => {
    expect(isSubcent('0.001')).toBe(true);
    expect(isSubcent('0.0099')).toBe(true);
    expect(isSubcent('0.01')).toBe(false);
  });
});
