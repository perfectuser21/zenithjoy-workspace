/**
 * lib.mjs — AI列（发版验收双表 · 机器列）核心库
 *
 * 导出：
 *   getMachineCellIds()          — 从规程文件取全部 machine_db 格号（S<步>-c<列>）
 *   checkCellsMapComplete(map)   — 采证映射与规程 1:1 校验（缺/多/重复均点名格号）
 *   validateAiColumn(column)     — AI列结果协议校验（schema + 20格完整性）
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { loadAndValidateSpec } from '../lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const SCHEMA_PATH = resolve(REPO_ROOT, 'acceptance-spec/ai-column.schema.json');

const CKEYS = ['c1', 'c2', 'c3', 'c4'];

/** 规程文件里全部 machine_db 格号，如 "S7-c1" */
export async function getMachineCellIds() {
  const { spec, errors } = await loadAndValidateSpec();
  if (errors.length > 0) {
    throw new Error(`规程文件校验失败: ${errors.join('; ')}`);
  }
  const ids = [];
  for (const st of spec.steps) {
    for (const ck of CKEYS) {
      const cell = st.cells[ck];
      if (!cell.na && cell.verifiable_by === 'machine_db') {
        ids.push(`S${st.n}-${ck}`);
      }
    }
  }
  return ids;
}

/** 规程文件里指定格的判据原文（供采证器/判官引用） */
export async function getCellCriteria() {
  const { spec, errors } = await loadAndValidateSpec();
  if (errors.length > 0) {
    throw new Error(`规程文件校验失败: ${errors.join('; ')}`);
  }
  const out = {};
  for (const st of spec.steps) {
    for (const ck of CKEYS) {
      const cell = st.cells[ck];
      if (!cell.na && cell.verifiable_by === 'machine_db') {
        out[`S${st.n}-${ck}`] = { criteria: cell.t, step_name: st.name };
      }
    }
  }
  return out;
}

/** 采证映射与规程 1:1：缺格/多格/重复格全部点名 */
export async function checkCellsMapComplete(cellsMap) {
  const specIds = new Set(await getMachineCellIds());
  const mapIds = cellsMap.map(c => c.id);
  const errors = [];

  const seen = new Set();
  for (const id of mapIds) {
    if (seen.has(id)) errors.push(`映射重复格: ${id}`);
    seen.add(id);
  }
  for (const id of specIds) {
    if (!seen.has(id)) errors.push(`映射缺少规程格: ${id}`);
  }
  for (const id of seen) {
    if (!specIds.has(id)) errors.push(`映射含规程外的格: ${id}`);
  }
  return { errors };
}

function getValidate() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  return ajv.compile(schema);
}

/** AI列结果校验：schema + machine_db 格完整性（缺/多/重复点名） */
export async function validateAiColumn(column) {
  const validate = getValidate();
  const errors = [];
  if (!validate(column)) {
    for (const e of validate.errors || []) {
      const path = e.instancePath || '/';
      errors.push(`协议错误 ${path}: ${e.message}`);
    }
    return { errors };
  }

  const specIds = new Set(await getMachineCellIds());
  const gotIds = column.cells.map(c => c.id);
  const seen = new Set();
  for (const id of gotIds) {
    if (seen.has(id)) errors.push(`结果重复格: ${id}`);
    seen.add(id);
  }
  for (const id of specIds) {
    if (!seen.has(id)) errors.push(`结果缺少格: ${id}`);
  }
  for (const id of seen) {
    if (!specIds.has(id)) errors.push(`结果含规程外的格: ${id}`);
  }
  return { errors };
}
