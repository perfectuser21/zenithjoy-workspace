// sanitizeApiBase — strip trailing \r (from CRLF .env) and trailing slashes
// Used by deriveHttpApiBase + videoPipelineLoop; extracted so it can be unit-tested
export function sanitizeApiBase(raw: string | undefined): string {
  return (raw || '').replace(/\r/g, '').trim().replace(/\/+$/, '');
}
