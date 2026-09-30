import { createHash } from 'node:crypto';

type Entry = { expires: number; payer?: string };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonical(record[key])}`);
    return `{${fields.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function paymentId(payload: unknown): string {
  return createHash('sha256')
    .update(canonical(payload))
    .digest('hex')
    .slice(0, 32);
}

export class PaymentLedger {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 100_000
  ) {}

  claim(id: string): boolean {
    const now = Date.now();
    this.prune(now);
    if (this.entries.has(id)) return false;
    this.entries.set(id, { expires: now + this.ttlMs });
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    return true;
  }

  setPayer(id: string, payer: string | undefined) {
    const entry = this.entries.get(id);
    if (entry && payer) entry.payer = payer;
  }

  payer(id: string): string | undefined {
    return this.entries.get(id)?.payer;
  }

  private prune(now: number) {
    for (const [id, entry] of this.entries) {
      if (entry.expires > now) return;
      this.entries.delete(id);
    }
  }
}
