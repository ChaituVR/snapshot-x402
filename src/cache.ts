type Entry<T> = { value: T; expires: number };

type Cached<T> = { value: T; maxAge: number };

export type Loaded<T> = { value: T; ttl: number };

export class TtlCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly pending = new Map<string, Promise<Cached<T>>>();

  constructor(private readonly maxEntries = 2000) {}

  get(key: string, load: () => Promise<Loaded<T>>): Promise<Cached<T>> {
    const hit = this.entries.get(key);
    const now = Date.now();
    if (hit && hit.expires > now) {
      return Promise.resolve({
        value: hit.value,
        maxAge: Math.ceil((hit.expires - now) / 1000)
      });
    }
    if (hit) this.entries.delete(key);

    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;

    const promise = load()
      .then(({ value, ttl }) => {
        this.set(key, value, ttl);
        return { value, maxAge: ttl };
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  private set(key: string, value: T, ttl: number) {
    if (ttl <= 0) return;
    this.entries.delete(key);
    this.entries.set(key, { value, expires: Date.now() + ttl * 1000 });
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }
}
