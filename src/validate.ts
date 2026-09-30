import { badRequest } from './errors';

const SPACE_ID = /^[^\s/?#%\\]+\.[^\s/?#%\\]+$/u;
const PROPOSAL_ID =
  /^(0x[0-9a-f]{64}|Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z2-7]{56})$/;
const HEX_PROPOSAL_ID = /^0x[0-9a-f]{64}$/i;
const VOTER = /^0x([0-9a-f]{40}|[0-9a-f]{64})$/i;

function single(name: string, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw badRequest(`${name} must be given once`);
  }
  return value;
}

export function spaceId(name: string, value: unknown): string {
  const id = single(name, value)?.toLowerCase() ?? '';
  if (id.length > 64 || !SPACE_ID.test(id)) {
    throw badRequest(`${name} must be a Snapshot space id like ens.eth`);
  }
  return id;
}

export function proposalId(name: string, value: unknown): string {
  const raw = single(name, value) ?? '';
  const id = HEX_PROPOSAL_ID.test(raw) ? raw.toLowerCase() : raw;
  if (!PROPOSAL_ID.test(id)) {
    throw badRequest(`${name} must be a proposal id (0x hash or IPFS CID)`);
  }
  return id;
}

export function voter(name: string, value: unknown): string {
  const address = single(name, value) ?? '';
  if (!VOTER.test(address)) {
    throw badRequest(`${name} must be a 0x address`);
  }
  return address.toLowerCase();
}

export function optional<T>(
  value: unknown,
  parse: (value: unknown) => T
): T | undefined {
  return value === undefined || value === '' ? undefined : parse(value);
}

export function integer(
  name: string,
  value: unknown,
  { min, max, fallback }: { min: number; max: number; fallback: number }
): number {
  const raw = single(name, value);
  if (raw === undefined || raw === '') return fallback;
  const number = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw badRequest(`${name} must be an integer from ${min} to ${max}`);
  }
  return number;
}

export function oneOf<T extends string>(
  name: string,
  value: unknown,
  allowed: readonly T[]
): T | undefined {
  const raw = single(name, value);
  if (raw === undefined || raw === '') return undefined;
  if (!allowed.includes(raw as T)) {
    throw badRequest(`${name} must be one of ${allowed.join(', ')}`);
  }
  return raw as T;
}
