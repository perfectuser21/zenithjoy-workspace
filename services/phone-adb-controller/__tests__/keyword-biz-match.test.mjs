// services/phone-adb-controller/__tests__/keyword-biz-match.test.mjs
//
// 10-07 悦升串词：next-keywords.js 用双向 includes 过滤业务线，
// 业务线为空的金诺词因 `"悦升云端".includes("") === true` 被悦升每批拿去补满 12 个词，
// 悦升合格率只剩 16~19%。修后：业务线精确匹配，空业务线谁都不匹配。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require_ = createRequire(import.meta.url);
const { keywordMatchesBiz } = require_('../keyword-enabled-lib.js');

test('业务线为空的词不匹配任何业务线（悦升不再拿到金诺空业务线词）', () => {
  assert.equal(keywordMatchesBiz('', '悦升云端'), false);
  assert.equal(keywordMatchesBiz('', 'AI人工智能训练师'), false);
  assert.equal(keywordMatchesBiz('   ', '悦升云端'), false);
  assert.equal(keywordMatchesBiz(undefined, '悦升云端'), false);
});

test('业务线精确匹配（去首尾空格），子串不算', () => {
  assert.equal(keywordMatchesBiz('悦升云端', '悦升云端'), true);
  assert.equal(keywordMatchesBiz(' AI人工智能训练师 ', 'AI人工智能训练师'), true);
  assert.equal(keywordMatchesBiz('人工智能训练师考证', 'AI人工智能训练师'), false);
  assert.equal(keywordMatchesBiz('AI人工智能训练师', '人工智能训练师'), false);
  assert.equal(keywordMatchesBiz('企业AI办公', '悦升云端'), false);
});

test('101关键词仅来自已冻结公司配置，不借用另一公司词表', async () => {
  const {createRequire}=await import('node:module');
  const {selectCompanyKeywords}=createRequire(import.meta.url)('../next-keywords.js');
  assert.deepEqual(selectCompanyKeywords({runtime_config:{search_strategy:{keywords:[{word:'悦升专属',enabled:true},{word:'停用词',enabled:false}]}}},6),['悦升专属']);
  assert.throws(()=>selectCompanyKeywords({runtime_config:{search_strategy:{}}},6),/COMPANY_SEARCH_KEYWORDS_REQUIRED/);
});
