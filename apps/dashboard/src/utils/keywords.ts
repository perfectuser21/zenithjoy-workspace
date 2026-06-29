export interface CompanyProfileForKeywords {
  company_name: string;
  city: string;
  industry: string;
  products: string[];
  key_advantages: string[];
}

export function buildRecommendedKeywords(profile: CompanyProfileForKeywords): string[] {
  const { city, industry, products } = profile;

  if (!city && !industry && products.length === 0) return [];

  const candidates: string[] = [];

  if (city && industry) candidates.push(`${city}${industry}`);
  if (industry) candidates.push(industry);

  for (const p of products) {
    if (!p) continue;
    if (city) candidates.push(`${p}${city}`);
    candidates.push(p);
  }

  if (city) candidates.push(`${city}美食推荐`);
  if (industry) candidates.push(`${industry}推荐`);

  const seen = new Set<string>();
  const result: string[] = [];
  for (const kw of candidates) {
    if (kw && !seen.has(kw)) {
      seen.add(kw);
      result.push(kw);
    }
  }

  return result.slice(0, 5);
}
