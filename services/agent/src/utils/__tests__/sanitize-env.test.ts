// Regression test: ZENITHJOY_API_BASE with trailing \r (from CRLF .env parsed by start.bat
// `for /f` loop) must be stripped before being used as an HTTP base URL.
// Failing before fix: deriveHttpApiBase returns "https://api.com\r" causing
// "TypeError: Failed to parse URL from https://api.com\r/api/agent/heartbeat"
import { describe, it, expect } from 'vitest';
import { sanitizeApiBase } from '../sanitize-env';

describe('sanitizeApiBase — CRLF regression', () => {
  it('strips trailing \\r (CRLF .env parsed by start.bat for/f)', () => {
    expect(sanitizeApiBase('https://api.example.com\r')).toBe('https://api.example.com');
  });

  it('strips trailing space', () => {
    expect(sanitizeApiBase('https://api.example.com ')).toBe('https://api.example.com');
  });

  it('strips trailing slash', () => {
    expect(sanitizeApiBase('https://api.example.com/')).toBe('https://api.example.com');
  });

  it('strips \\r then trailing slash combined', () => {
    expect(sanitizeApiBase('https://api.example.com\r/')).toBe('https://api.example.com');
  });

  it('returns empty string for undefined', () => {
    expect(sanitizeApiBase(undefined)).toBe('');
  });

  it('leaves clean URL unchanged', () => {
    expect(sanitizeApiBase('https://api.example.com')).toBe('https://api.example.com');
  });
});
