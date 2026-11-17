import {createHash} from 'node:crypto';
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => {throw Error(message);};
export function canonical(value, seen = new Set(), depth = 0) {
  if (depth > 40) fail('commander_json_invalid');
  if (value === null || ['string','boolean'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!object(value) && !Array.isArray(value) || seen.has(value)
    || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value))) fail('commander_json_invalid');
  seen.add(value);
  const result = Array.isArray(value) ? value.map(x => canonical(x, seen, depth + 1))
    : Object.fromEntries(Object.keys(value).sort().map(k => {
      if (['__proto__','constructor','prototype'].includes(k)) fail('commander_json_invalid');
      return [k, canonical(value[k], seen, depth + 1)];
    }));
  seen.delete(value); return result;
}
export const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
