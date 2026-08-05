/**
 * Pull the message the server actually sent out of a thrown value.
 *
 * `ApiClient.request` builds its Error from `body.error`, so the server's own
 * wording — "Video exceeds the 20 minute limit", "Storage quota reached" —
 * arrives here intact. Replacing it with a generic string throws away the only
 * part the user can act on.
 */
export function errorDetail(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}
