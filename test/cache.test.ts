import { TtlCache } from '../src/cache';

describe('TtlCache', () => {
  afterEach(() => jest.useRealTimers());

  it('serves a value until its TTL ends', async () => {
    jest.useFakeTimers({ now: 0 });
    const cache = new TtlCache<number>();
    const load = jest.fn(async () => ({ value: 1, ttl: 10 }));

    expect(await cache.get('a', load)).toEqual({ value: 1, maxAge: 10 });
    jest.setSystemTime(4000);
    expect(await cache.get('a', load)).toEqual({ value: 1, maxAge: 6 });
    jest.setSystemTime(10001);
    await cache.get('a', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('shares one upstream call between concurrent requests', async () => {
    const cache = new TtlCache<number>();
    let resolve: (value: { value: number; ttl: number }) => void = () =>
      undefined;
    const load = jest.fn(
      () =>
        new Promise<{ value: number; ttl: number }>(done => (resolve = done))
    );

    const results = Promise.all([cache.get('a', load), cache.get('a', load)]);
    resolve({ value: 7, ttl: 5 });

    expect((await results).map(result => result.value)).toEqual([7, 7]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not keep failures', async () => {
    const cache = new TtlCache<number>();
    await expect(
      cache.get('a', async () => Promise.reject(new Error('down')))
    ).rejects.toThrow('down');
    expect(await cache.get('a', async () => ({ value: 2, ttl: 5 }))).toEqual({
      value: 2,
      maxAge: 5
    });
  });

  it('evicts the oldest entry when full', async () => {
    const cache = new TtlCache<string>(2);
    const load = (value: string) => jest.fn(async () => ({ value, ttl: 60 }));
    await cache.get('a', load('a'));
    await cache.get('b', load('b'));
    await cache.get('c', load('c'));
    const reload = load('a2');

    expect((await cache.get('a', reload)).value).toBe('a2');
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
