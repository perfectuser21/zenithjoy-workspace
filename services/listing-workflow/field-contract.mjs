// 小型闭合 schema 方言；未知关键字拒绝，避免误以为未实现约束已经生效。
const keys = new Set(['type', 'minimum', 'maximum', 'minLength', 'minItems', 'items', 'required', 'properties', 'additionalProperties']);
const types = new Set(['string', 'number', 'integer', 'boolean', 'null', 'array', 'object']);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export function validSchema(schema) {
  if (!object(schema) || !types.has(schema.type) || Object.keys(schema).some(k => !keys.has(k))) return false;
  for (const k of ['minimum', 'maximum']) if (has(schema, k) && !Number.isFinite(schema[k])) return false;
  if (has(schema, 'minimum') && has(schema, 'maximum') && schema.minimum > schema.maximum) return false;
  for (const k of ['minLength', 'minItems']) if (has(schema, k) && (!Number.isSafeInteger(schema[k]) || schema[k] < 0)) return false;
  if (schema.type === 'array' && (!validSchema(schema.items) || !has(schema, 'minItems'))) return false;
  if (schema.type === 'object') {
    if (!object(schema.properties) || !Array.isArray(schema.required) || schema.required.some(k => typeof k !== 'string' || !has(schema.properties, k)) ||
      Object.values(schema.properties).some(s => !validSchema(s))) return false;
    if (has(schema, 'additionalProperties') && typeof schema.additionalProperties !== 'boolean') return false;
  }
  return true;
}

export function matchesSchema(value, schema) {
  switch (schema.type) {
    case 'null': return value === null;
    case 'boolean': return typeof value === 'boolean';
    case 'string': return typeof value === 'string' && value.trim().length >= (schema.minLength ?? 0);
    case 'integer':
    case 'number': return typeof value === 'number' && Number.isFinite(value) && (schema.type !== 'integer' || Number.isSafeInteger(value)) &&
      (!has(schema, 'minimum') || value >= schema.minimum) && (!has(schema, 'maximum') || value <= schema.maximum);
    case 'array': return Array.isArray(value) && value.length >= schema.minItems && value.every(v => matchesSchema(v, schema.items));
    case 'object': return object(value) && schema.required.every(k => has(value, k)) && Object.entries(value).every(([k, v]) =>
      has(schema.properties, k) ? matchesSchema(v, schema.properties[k]) : schema.additionalProperties === true);
    default: return false;
  }
}
