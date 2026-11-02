export function formatApiFailure(data: Record<string, unknown>, fallback: string): string {
  const status = Number(data.status);
  const hint = typeof data.hint === 'string' ? data.hint : null;
  const message = typeof data.message === 'string' ? data.message : null;
  const cause = typeof data.cause === 'string' ? data.cause : null;

  if (hint) return hint;
  if (message) return message;
  if (status === 8905 || cause === 'out of limit') {
    return 'GPS51 account daily call quota exhausted (8905). Same account is shared with other SafeTrack apps — wait for reset and avoid repeated Load clicks.';
  }
  if (status === 8902) {
    return 'GPS51 IP rate limit (~10 requests/minute). Wait about a minute.';
  }
  return cause || fallback;
}
