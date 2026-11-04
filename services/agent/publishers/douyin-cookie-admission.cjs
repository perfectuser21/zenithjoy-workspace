'use strict';

// Shape admission only. The platform must still validate the session during navigation.
// sid_tt alone is outside the established QR producer readiness contract.
function isDouyinDomain(domain) {
  return typeof domain === 'string' &&
    /^(?:\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*douyin\.com$/i.test(domain);
}

function hasUsableExpiry(cookie, nowSeconds) {
  return cookie.expires === undefined || cookie.expires === -1 ||
    (typeof cookie.expires === 'number' && Number.isFinite(cookie.expires) && cookie.expires > nowSeconds);
}

function isUsableDouyinCookie(cookie, nowSeconds = Date.now() / 1000) {
  return !!cookie && isDouyinDomain(cookie.domain) &&
    typeof cookie.name === 'string' && cookie.name.length > 0 &&
    typeof cookie.value === 'string' && cookie.value.length > 0 &&
    hasUsableExpiry(cookie, nowSeconds);
}

function isDouyinSessionCookie(cookie, nowSeconds = Date.now() / 1000) {
  return isUsableDouyinCookie(cookie, nowSeconds) &&
    ['sessionid', 'sessionid_ss'].includes(cookie.name) &&
    cookie.value.length > 20 && !/\s/.test(cookie.value);
}

function findDouyinSessionCookie(cookies, nowSeconds = Date.now() / 1000) {
  return Array.isArray(cookies) ? cookies.find(cookie => isDouyinSessionCookie(cookie, nowSeconds)) : undefined;
}

module.exports = { isDouyinDomain, isUsableDouyinCookie, isDouyinSessionCookie, findDouyinSessionCookie };
