"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRecommendedKeywords = buildRecommendedKeywords;

function buildRecommendedKeywords(profile) {
  const { city, industry, products } = profile;

  if (!city && !industry && products.length === 0) return [];

  const candidates = [];

  if (city && industry) candidates.push(city + industry);
  if (industry) candidates.push(industry);

  for (const p of products) {
    if (!p) continue;
    if (city) candidates.push(p + city);
    candidates.push(p);
  }

  if (city) candidates.push(city + '美食推荐');
  if (industry) candidates.push(industry + '推荐');

  const seen = new Set();
  const result = [];
  for (const kw of candidates) {
    if (kw && !seen.has(kw)) {
      seen.add(kw);
      result.push(kw);
    }
  }

  return result.slice(0, 5);
}
