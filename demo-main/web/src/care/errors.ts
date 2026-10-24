/** User-facing text for a failed api.ts call. */
export function errorMessage(e: unknown, fallback: string): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === 'not_implemented') return `${fallback}: not available with this data source yet.`;
  if (code === 'network') return `${fallback}: can't reach the data source. Try again.`;
  return e instanceof Error && e.message ? `${fallback}: ${e.message}` : fallback;
}

export function isNotImplemented(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === 'not_implemented';
}
