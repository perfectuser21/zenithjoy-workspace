import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 真机复现（2026-07-28）：GET /api/staff/line-health 在 hk-vps staging 容器上
 * 恒返回 source=fallback / fallback_reason 含 "ENOENT ... product-map/generated/product-map.json"。
 * 根因：apps/api/Dockerfile 生产阶段只 COPY 了 dist/ + package.json，从未把仓库根的
 * product-map/ 目录拷进镜像——line-health.ts 运行时按相对路径找不到该文件，
 * 永远走硬编码兜底清单，不是它本该读的权威数据源。
 */
describe('Dockerfile 必须把 product-map/ 拷进生产镜像', () => {
  it('生产阶段（第二个 FROM 之后）含 COPY product-map 指令', () => {
    const dockerfilePath = resolve(__dirname, '../../../Dockerfile');
    const content = readFileSync(dockerfilePath, 'utf-8');

    // 定位生产阶段：第二个 "FROM node" 之后的内容
    const fromLines = [...content.matchAll(/^FROM .+$/gm)];
    expect(fromLines.length).toBeGreaterThanOrEqual(2);
    const prodStageStart = fromLines[fromLines.length - 1].index ?? 0;
    const prodStage = content.slice(prodStageStart);

    expect(prodStage).toMatch(/COPY\s+\S*product-map\S*\s+\S*product-map\S*/);
  });
});
