// services/agent/src/__tests__/start-bat-env-append-encoding.test.ts
//
// 真机实证（2026-07-16，孙燕青/于瑾/xian-rog 三台机器都复现）：start.bat 里三处
// "字段不存在才追加"的幂等检查（ZENITHJOY_AGENT_DRYRUN_BROWSER / ZENITHJOY_AGENT_REAL_PUBLISH /
// ZENITHJOY_ENV）在真实客户机上失效——同一个字段被反复追加多次（例：
// `ZENITHJOY_ENV=staging` 后面跟了 9 行 `ZENITHJOY_ENV=prod`）。
//
// 已排除工作目录问题（start.bat 顶部有 `cd /d "%~dp0"`，.env 路径解析稳定）。
// 本代码库历史上反复实锤过同一类根因：Windows PowerShell 5.1 的 Select-String/
// Add-Content 默认编码探测与含中文内容的文件（.env 常有 `ZJ_MAIN_DATA_DIR=...测试 1`
// 这样的中文路径）不一致，导致模式匹配读到乱码、"字段已存在"检测不出来。
//
// 修法：三处 Select-String 和 Add-Content 都显式指定 -Encoding utf8，消除编码探测
// 歧义（标准做法，不依赖精确证明具体字节级机制）。
//
// proven-to-fire：把某一处的 -Encoding utf8 删掉，对应断言立即红。

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const INSTALL_PACK = resolve(__dirname, '../../install-pack');
const START_BAT = readFileSync(resolve(INSTALL_PACK, 'start.bat'), 'utf-8');

const ENV_KEYS = [
  'ZENITHJOY_AGENT_DRYRUN_BROWSER',
  'ZENITHJOY_AGENT_REAL_PUBLISH',
  'ZENITHJOY_ENV',
];

describe('start.bat — .env 幂等追加检查显式指定编码（防重复追加）', () => {
  for (const key of ENV_KEYS) {
    it(`${key} 的 Select-String 检查显式指定 -Encoding utf8`, () => {
      // 精确截到本条 Select-String 子句自己的 -Quiet 收尾，不能只看"这一行有没有
      // 出现 -Encoding utf8"——Select-String 和 Add-Content 共享同一物理行，只看
      // 整行会被"只改 Add-Content 那半、Select-String 仍缺失"这种部分修复骗过。
      const idx = START_BAT.search(
        new RegExp(`Select-String[^\\n]*Pattern '${key}'`),
      );
      expect(idx).toBeGreaterThan(-1);
      const quietIdx = START_BAT.indexOf('-Quiet', idx);
      expect(quietIdx).toBeGreaterThan(idx);
      const clause = START_BAT.slice(idx, quietIdx + '-Quiet'.length);
      expect(clause).toMatch(/-Encoding\s+[Uu][Tt][Ff]8/);
    });

    it(`${key} 的 Add-Content 追加显式指定 -Encoding utf8`, () => {
      const lineIdx = START_BAT.search(
        new RegExp(`Add-Content[^\\n]*Value '${key}=`),
      );
      expect(lineIdx).toBeGreaterThan(-1);
      const line = START_BAT.slice(lineIdx, START_BAT.indexOf('\n', lineIdx));
      expect(line).toMatch(/-Encoding\s+[Uu][Tt][Ff]8/);
    });
  }
});
