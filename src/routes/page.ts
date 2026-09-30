export const MAX_SKIP = 5000;

type PageInput = {
  path: string;
  query: Record<string, string | number | null>;
  first: number;
  skip: number;
  count: number;
  total?: number;
};

export function page({ path, query, first, skip, count, total }: PageInput) {
  const hasMore = total === undefined ? count === first : skip + count < total;
  const nextSkip = skip + first;
  if (!hasMore || nextSkip > MAX_SKIP) return { hasMore, next: null };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({
    ...query,
    first,
    skip: nextSkip
  })) {
    if (value !== null) params.set(key, String(value));
  }
  return { hasMore, next: `${path}?${params}` };
}
