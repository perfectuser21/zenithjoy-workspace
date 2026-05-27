import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '../../../../');

describe('WS1 — original_script + target_aspect 字段 [BEHAVIOR]', () => {
  it('AiVideoPipelineService.createJob 函数签名接受 originalScript 参数', () => {
    const src = readFileSync(join(ROOT, 'apps/api/src/services/ai-video-pipeline.service.ts'), 'utf8');
    // WS1 实现前: createJob 不含 originalScript → 此测试 FAIL
    expect(src).toContain('originalScript');
    // INSERT 语句必须含 original_script 列
    expect(src).toMatch(/INSERT.*original_script|original_script.*INSERT/s);
  });

  it('DB migration 含 original_script 列定义 (ADD COLUMN original_script)', () => {
    const migrationsDir = join(ROOT, 'apps/api/db/migrations');
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    const hasOriginalScript = files.some((f) => {
      try {
        const content = readFileSync(join(migrationsDir, f), 'utf8');
        return (
          content.includes('original_script') &&
          content.includes('ai_video_pipeline_jobs')
        );
      } catch {
        return false;
      }
    });
    // WS1 实现前: 无 migration 含 original_script → FAIL
    expect(hasOriginalScript).toBe(true);
  });

  it('LocalVideoPipelinePage 含 original_script textarea + 原始文案标签', () => {
    const src = readFileSync(
      join(ROOT, 'apps/dashboard/src/pages/LocalVideoPipelinePage.tsx'),
      'utf8',
    );
    // WS1 实现前: 前端无此字段 → FAIL
    expect(src).toContain('original_script');
    expect(src).toContain('原始文案');
  });

  it('AI controller composeHtml/analyzeTranscript 含 original_script 条件注入（含空值保护）', () => {
    const src = readFileSync(
      join(ROOT, 'apps/api/src/controllers/ai-video-pipeline-ai.controller.ts'),
      'utf8',
    );
    // WS1 实现前: prompt 无 original_script 注入 → FAIL
    expect(src).toContain('original_script');
    // 空值保护模式
    const hasGuard = /if\s*\(.*original_script|original_script\s*\?\?|original_script\s*&&/.test(src);
    expect(hasGuard).toBe(true);
    // 含中文注入前缀（"用户录制前参考文案"或类似文本）
    expect(src).toMatch(/用户录制前参考文案|original.script.*prompt|prompt.*original.script/s);
  });
});
