import { describe, it, expect } from 'vitest';
import * as fs from 'fs';

const SERVICE_SRC = fs.readFileSync('apps/api/src/services/ai-video-pipeline.service.ts', 'utf8');
const CONTROLLER_SRC = fs.readFileSync('apps/api/src/controllers/ai-video-pipeline.controller.ts', 'utf8');

describe('WS1 — DB migration 三列 [BEHAVIOR]', () => {
  it('migration 文件存在且含 original_script 列定义', () => {
    const files = fs.readdirSync('apps/api/db/migrations');
    const migFile = files.find((f) => /original_script|20260527/.test(f) && f.endsWith('.sql'));
    expect(migFile, '找不到含 original_script 的 migration 文件').toBeTruthy();
    const content = fs.readFileSync(`apps/api/db/migrations/${migFile}`, 'utf8');
    expect(content).toContain('original_script');
    expect(content).toContain('target_aspect');
    expect(content).toContain('detected_aspect');
  });

  it('migration 使用 ADD COLUMN IF NOT EXISTS（幂等）', () => {
    const files = fs.readdirSync('apps/api/db/migrations');
    const migFile = files.find((f) => /original_script|20260527/.test(f) && f.endsWith('.sql'));
    if (!migFile) return;
    const content = fs.readFileSync(`apps/api/db/migrations/${migFile}`, 'utf8');
    expect(content).toContain('ADD COLUMN IF NOT EXISTS');
    expect(content).toContain('ai_video_pipeline_jobs');
  });

  it('target_aspect CHECK 约束含 9:16 和 16:9', () => {
    const files = fs.readdirSync('apps/api/db/migrations');
    const migFile = files.find((f) => /original_script|20260527/.test(f) && f.endsWith('.sql'));
    if (!migFile) return;
    const content = fs.readFileSync(`apps/api/db/migrations/${migFile}`, 'utf8');
    expect(content).toContain('9:16');
    expect(content).toContain('16:9');
  });
});

describe('WS1 — PipelineJob interface 含新字段 [BEHAVIOR]', () => {
  it('PipelineJob interface 含 original_script 字段', () => {
    expect(SERVICE_SRC).toContain('original_script');
  });

  it('PipelineJob interface 含 target_aspect 字段', () => {
    expect(SERVICE_SRC).toContain('target_aspect');
  });

  it('PipelineJob interface 含 detected_aspect 字段', () => {
    expect(SERVICE_SRC).toContain('detected_aspect');
  });

  it('service updateStatus 方法支持写入 detected_aspect', () => {
    expect(SERVICE_SRC).toContain('detected_aspect');
    const updateStatusBlock = SERVICE_SRC.slice(SERVICE_SRC.indexOf('updateStatus'), SERVICE_SRC.indexOf('updateStatus') + 1000);
    expect(updateStatusBlock).toContain('detected_aspect');
  });
});

describe('WS1 — controller 读写新字段 [BEHAVIOR]', () => {
  it('createJob controller 从 req.body 读取 original_script', () => {
    expect(CONTROLLER_SRC).toContain('original_script');
  });

  it('createJob controller 从 req.body 读取 target_aspect', () => {
    expect(CONTROLLER_SRC).toContain('target_aspect');
  });

  it('updateProgress controller 支持 detected_aspect 写回', () => {
    expect(CONTROLLER_SRC).toContain('detected_aspect');
  });

  it('禁用字段名不出现（aspect_ratio / raw_script / source_script）', () => {
    expect(CONTROLLER_SRC).not.toContain('aspect_ratio:');
    expect(CONTROLLER_SRC).not.toContain('raw_script:');
    expect(CONTROLLER_SRC).not.toContain('source_script:');
  });
});
