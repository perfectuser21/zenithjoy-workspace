/**
 * Build info — 发版自洽的"真上新代码"探针。
 *
 * 治根（2026-06-22 真实事故）：发版 workflow 报"成功"但旧 node 进程仍占 :5200，
 * 新代码 build 进 dist 却没真换进程，API 继续返回旧行为，无人察觉。
 *
 * 解法：build 时把当前 git commit sha / version / 构建时间写进 dist/build-info.json，
 * 进程启动后通过 /version 暴露。发版脚本在干净重启后断言 /version.sha == 刚部署 commit，
 * 不一致 → 发版红（说明跑的是旧进程）。
 *
 * 来源优先级（高 → 低）：
 *   1. 环境变量 BUILD_SHA / BUILD_VERSION / BUILD_TIME（CI / 容器可注入，最权威）
 *   2. dist/build-info.json（build 脚本 scripts/write-build-info.sh 生成）
 *   3. 兜底 'unknown'（本地 dev / 未生成时）
 */
import * as fs from 'fs';
import * as path from 'path';

export interface BuildInfo {
  sha: string;
  version: string;
  buildTime: string;
}

const UNKNOWN = 'unknown';

/**
 * 读取构建信息。
 *
 * @param env  环境变量（默认 process.env），便于测试注入
 * @param fileReader  读 build-info.json 的函数（默认从 dist 读），便于测试注入
 */
export function getBuildInfo(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  fileReader: () => Partial<BuildInfo> | null = readBuildInfoFile,
): BuildInfo {
  const fromFile = safeRead(fileReader);

  const sha = pick(env.BUILD_SHA, fromFile.sha);
  const version = pick(env.BUILD_VERSION, fromFile.version);
  const buildTime = pick(env.BUILD_TIME, fromFile.buildTime);

  return {
    sha: sha ?? UNKNOWN,
    version: version ?? UNKNOWN,
    buildTime: buildTime ?? UNKNOWN,
  };
}

function pick(
  envVal: string | undefined,
  fileVal: string | undefined,
): string | undefined {
  if (envVal != null && String(envVal).trim() !== '') return String(envVal).trim();
  if (fileVal != null && String(fileVal).trim() !== '') return String(fileVal).trim();
  return undefined;
}

function safeRead(
  fileReader: () => Partial<BuildInfo> | null,
): Partial<BuildInfo> {
  try {
    return fileReader() ?? {};
  } catch {
    return {};
  }
}

/**
 * 默认实现：从编译产物同级目录读 build-info.json。
 * 编译后本文件在 dist/build-info.js，build-info.json 与其同级。
 */
export function readBuildInfoFile(): Partial<BuildInfo> | null {
  const candidate = path.join(__dirname, 'build-info.json');
  if (!fs.existsSync(candidate)) return null;
  const raw = fs.readFileSync(candidate, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<BuildInfo>;
  return parsed;
}
