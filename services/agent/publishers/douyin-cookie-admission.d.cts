export function isDouyinPageUrl(candidate: unknown): boolean;
export function isDouyinDomain(domain: unknown): boolean;
export function isUsableDouyinCookie(cookie: unknown, nowSeconds?: number): boolean;
export function isDouyinSessionCookie(cookie: unknown, nowSeconds?: number): boolean;
export function findDouyinSessionCookie(cookies: unknown, nowSeconds?: number): unknown;
