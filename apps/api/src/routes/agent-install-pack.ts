// Sprint 2.1e — install pack manifest endpoint
// Sprint 2.1f Fix 7 — download handler server-side license burn-in 重写
import { Router, type Request, type Response } from 'express';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
// 使用动态 require 避免 vitest mock child_process 时的 execFile export 检查失败
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const execFileAsync: (file: string, args?: readonly string[] | null) => Promise<{ stdout: string; stderr: string }> =
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  promisify((require('child_process') as any).execFile);
import { fromNodeHeaders } from 'better-auth/node';
import pool from '../db/connection';
import { auth } from '../auth';
import { readInstallPackManifest, type InstallPackManifest } from '../services/install-pack-manifest';
import { internalAuth } from '../middleware/internal-auth';

// 从远端 URL 下载 tar.gz 到本地路径，原子写（先 .downloading 再 rename）
// dest 必须在可写目录（如 /tmp），不能是只读挂载路径
function downloadFileToPath(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tmp = dest + '.downloading';
    fs.rmSync(tmp, { force: true });
    let settled = false;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };
    const file = fs.createWriteStream(tmp);
    file.on('error', (err) => {
      fs.rmSync(tmp, { force: true });
      done(err);
    });
    const protocol = url.startsWith('https://') ? https : http;
    protocol.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.destroy();
        fs.rmSync(tmp, { force: true });
        done(new Error(`remote fetch ${url} → HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          try { fs.renameSync(tmp, dest); } catch (e) { done(e as Error); return; }
          done();
        });
      });
    }).on('error', (err) => {
      file.destroy();
      fs.rmSync(tmp, { force: true });
      done(err);
    });
  });
}

export const agentInstallPackRouter = Router();

// ── agent→staging 隔离：按"本 API 实例自己的对外地址"烧 .env ──────────────────
// 让"从 staging 域名下载的 agent 自动连 staging、从生产下载的连生产"，零写死。
// 地址从本进程 env 读（staging slot / 生产 slot 各配自己的 AGENT_PUBLIC_*），不硬编码。
//   · AGENT_PUBLIC_WS_URL   → 烧成 .env 的 ZENITHJOY_API_URL（wss://.../agent-ws，agent 走 WS 连）
//   · AGENT_PUBLIC_BASE_URL → 烧成 .env 的 ZENITHJOY_API_BASE（https:// 根，注册/心跳/install-pack 用）
// start.bat 加载顺序是「先 source .env（set），再 if not defined 兜底生产值」，所以 .env 烧了值就赢，
// start.bat 不需要改。两个 env 都没配（如本地 dev）→ 返回空，行为同旧（agent 用 start.bat 生产兜底）。
function agentApiUrlEnvLines(): string[] {
  const lines: string[] = [];
  const wsUrl = (process.env.AGENT_PUBLIC_WS_URL || '').trim();
  const baseUrl = (process.env.AGENT_PUBLIC_BASE_URL || '').trim();
  if (wsUrl) lines.push(`ZENITHJOY_API_URL=${wsUrl}`);
  if (baseUrl) lines.push(`ZENITHJOY_API_BASE=${baseUrl}`);
  // 遗留② 根治：从本实例对外地址推导 ZENITHJOY_ENV 一并烧进个人 .env，让 .env 自描述当前环境。
  // 没有这行时，个人 .env 只带 staging URL 而缺 staging 标记，一旦用户没应用个人 .env、
  // 回落到 COS 包 .env.template 写死的生产默认值，就会"从 staging 下载却连生产"（OTA 也拿回生产旧版）。
  // staging slot 的 base URL 含 "staging" → staging；生产 slot（autopilot）→ prod；未配 → 不烧（行为同旧）。
  if (baseUrl) {
    const env = baseUrl.toLowerCase().includes('staging') ? 'staging' : 'prod';
    lines.push(`ZENITHJOY_ENV=${env}`);
  }
  return lines;
}

// 把一组 KEY=VALUE 行 upsert 进 .env 文本：已有该 KEY 行就替换，没有就追加。幂等。
function upsertEnvLines(envText: string, kvLines: string[]): string {
  let out = envText;
  for (const line of kvLines) {
    const key = line.slice(0, line.indexOf('='));
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(out)) {
      out = out.replace(re, line);
    } else {
      out = (out.endsWith('\n') || out === '' ? out : out + '\n') + line + '\n';
    }
  }
  return out;
}

agentInstallPackRouter.get('/manifest', (_req: Request, res: Response) => {
  const m = readInstallPackManifest();
  if (!m) {
    return res.status(503).json({
      ok: false,
      code: 'INSTALL_PACK_NOT_BUILT',
      message: 'install pack not built yet — wait for next CI run',
    });
  }
  return res.status(200).json(m);
});

// CI deploy endpoint — update manifest.json without SSH
// Protected by ZENITHJOY_INTERNAL_TOKEN (same as other internal endpoints)
agentInstallPackRouter.put('/manifest', internalAuth, (req: Request, res: Response) => {
  const body = req.body as Partial<InstallPackManifest>;
  if (
    typeof body?.version !== 'string' ||
    typeof body?.sha256 !== 'string' ||
    typeof body?.download_url !== 'string'
  ) {
    return res.status(400).json({ ok: false, code: 'INVALID_MANIFEST', message: 'version/sha256/download_url required' });
  }
  const manifestPath =
    process.env.INSTALL_PACK_MANIFEST_PATH ||
    '/opt/zenithjoy/install-pack/manifest.json';
  try {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(body, null, 2) + '\n', 'utf-8');
    console.log(`[install-pack/manifest] updated to v${body.version} via HTTP deploy`);
    return res.status(200).json({ ok: true, version: body.version });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[install-pack/manifest] write failed:', msg);
    return res.status(500).json({ ok: false, code: 'WRITE_FAILED', message: msg });
  }
});

// Sprint 2.1f Fix 7 — server-side license burn-in
// 客户登录 → 查 license → 拷贝静态 tar.gz 到 tmp → 替换 .env 里 ZENITHJOY_LICENSE=
//   → 重打包成 tar.gz → stream 回客户端 → 完成后清 tmp
agentInstallPackRouter.get('/download', async (req: Request, res: Response) => {
  // 1. 鉴权
  let userId: string | null = null;
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const u = session?.user;
    if (u && typeof u.id === 'string' && u.id.length > 0) userId = u.id;
  } catch (err) {
    console.warn('[install-pack/download] session 解析失败:', err);
  }
  if (!userId) {
    return res.status(401).json({ ok: false, code: 'UNAUTHORIZED' });
  }

  // 2. 查 user 的 active license（取最新一条）
  let licenseKey: string;
  try {
    const { rows } = await pool.query<{ license_key: string }>(
      `SELECT license_key
         FROM zenithjoy.licenses
        WHERE customer_id = $1 AND status = 'active'
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId]
    );
    if (rows.length === 0) {
      return res.status(503).json({
        ok: false,
        code: 'NO_ACTIVE_LICENSE',
        message: 'no active license bound to your account; 请回 Account 页确认',
      });
    }
    licenseKey = rows[0].license_key;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return res.status(500).json({ ok: false, code: 'DB_ERROR', message: msg });
  }

  // 3. 找静态 tar.gz 源文件
  const m = readInstallPackManifest();
  if (!m) {
    return res.status(503).json({ ok: false, code: 'INSTALL_PACK_NOT_BUILT' });
  }

  // Gap3 修复：大包别经服务器中转流式（"从 COS 拉 322MB 回服务器再重打包流式回传"经 CF tunnel
  // 只回 19.5MB 就断、tar 解不开）。manifest 有 cos_url → 鉴权通过后直接 302 重定向到 COS 直链，
  // 客户端直连 COS 拉整包（rog 实测 COS 直链 322MB 7.6s OK）。license 走独立 /dotenv 端点（个人 .env），
  // 不再夹进 tar 重打包——既避开流式截断，也省去服务器重打包大包的开销。
  if (m.cos_url && m.cos_url.trim()) {
    console.log(`[install-pack/download] 302 → COS 直链（大包不中转）: ${m.cos_url}`);
    return res.redirect(302, m.cos_url.trim());
  }

  // download_url 形如 /download/zenithjoy-agent-v1.0.1.tar.gz
  // 静态根目录从 manifest 路径推：默认 /opt/zenithjoy/autopilot-dashboard/dist
  const STATIC_ROOT =
    process.env.INSTALL_PACK_STATIC_ROOT ||
    '/opt/zenithjoy/autopilot-dashboard/dist';
  const srcTar = process.env.INSTALL_PACK_FIXTURE_PATH || // test override
    path.join(STATIC_ROOT, m.download_url.replace(/^\/+/, ''));
  let effectiveSrcTar = srcTar;
  if (!fs.existsSync(srcTar)) {
    // Fallback：本地文件不存在时，从 cos_url 或 INSTALL_PACK_REMOTE_URL 拉取
    // 写到 /tmp 而非静态根目录，避免 EROFS（静态根可能是只读挂载）
    const remoteUrl = m.cos_url || process.env.INSTALL_PACK_REMOTE_URL;
    if (remoteUrl) {
      const tmpTar = path.join(os.tmpdir(), path.basename(srcTar));
      console.log(`[install-pack/download] 本地 tar.gz 不存在，从远端拉取到 /tmp: ${remoteUrl}`);
      try {
        await downloadFileToPath(remoteUrl, tmpTar);
        effectiveSrcTar = tmpTar;
        console.log(`[install-pack/download] 远端拉取成功: ${tmpTar}`);
      } catch (dlErr) {
        console.error('[install-pack/download] 远端拉取失败:', dlErr);
        return res.status(503).json({
          ok: false,
          code: 'INSTALL_PACK_NOT_BUILT',
          message: `tar.gz not at ${srcTar}, remote fetch also failed: ${dlErr instanceof Error ? dlErr.message : dlErr}`,
        });
      }
    } else {
      return res.status(503).json({
        ok: false,
        code: 'INSTALL_PACK_NOT_BUILT',
        message: `static tar.gz not found at ${srcTar}`,
      });
    }
  }

  // 4. 解压到 tmp → 替换 .env → 重打包
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `install-pack-${userId}-`));
  try {
    await execFileAsync('tar', ['-xzf', effectiveSrcTar, '-C', tmp]);
    // 找 .env（可能在子目录 zenithjoy-agent-vX.Y.Z/ 里）
    let envPath: string | null = null;
    function walk(dir: string): void {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(full);
        else if (ent.name === '.env' || ent.name === '.env.template') {
          if (envPath === null || ent.name === '.env') envPath = full;
        }
      }
    }
    walk(tmp);
    if (!envPath) {
      throw new Error('.env not found in install pack');
    }
    // 烧入：替换 ZENITHJOY_LICENSE=... 行；sprint 2.1f Task 2 减肥后 .env.template 没占位行 — fallback append
    const orig = fs.readFileSync(envPath, 'utf-8');
    let burned = orig.replace(
      /^ZENITHJOY_LICENSE=.*$/m,
      `ZENITHJOY_LICENSE=${licenseKey}`
    );
    if (burned === orig) {
      burned = (orig.endsWith('\n') ? orig : orig + '\n') + `ZENITHJOY_LICENSE=${licenseKey}\n`;
    }
    // agent→staging 隔离：再烧本实例对外地址（staging slot 烧 staging 域名，生产 slot 烧生产域名）。
    // 两个 AGENT_PUBLIC_* env 都没配则 no-op，行为同旧（靠 start.bat 生产兜底）。
    burned = upsertEnvLines(burned, agentApiUrlEnvLines());
    const targetEnv: string = envPath;
    fs.writeFileSync(targetEnv, burned, 'utf-8');
    // 如果是 .env.template 烧的，复制一份成 .env
    if (targetEnv.endsWith('.env.template')) {
      fs.writeFileSync(targetEnv.replace(/\.template$/, ''), burned, 'utf-8');
    }

    // 5. 重打包 — outTar 放 tmp 外，避免 tar 同时读写自己 ("file changed as we read it")
    const outTar = path.join(os.tmpdir(), `install-pack-out-${process.pid}-${Date.now()}.tar.gz`);
    // 找子目录名（zenithjoy-agent-vX.Y.Z）
    const entries = fs.readdirSync(tmp, { withFileTypes: true });
    const subdir = entries.find((e) => e.isDirectory());
    const tarArgs = subdir
      ? ['-czf', outTar, '-C', tmp, subdir.name]
      : ['-czf', outTar, '-C', tmp, '.'];
    await execFileAsync('tar', tarArgs);

    // 6. stream 回客户端 + cleanup
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="zenithjoy-agent-${m.version}.tar.gz"`
    );
    const stream = fs.createReadStream(outTar);
    stream.on('end', () => {
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.rmSync(outTar, { force: true });
    });
    stream.on('error', (err) => {
      console.error('[install-pack/download] stream error:', err);
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.rmSync(outTar, { force: true });
    });
    stream.pipe(res);
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    const msg = err instanceof Error ? err.message : 'unknown';
    console.error('[install-pack/download] burn-in failed:', err);
    return res.status(500).json({ ok: false, code: 'BURN_IN_FAILED', message: msg });
  }
});

// COS CDN 路由 v2 — 大包走 COS CDN 直连，API 只出个人 .env（< 1KB）
// 客户端流程：① 大包从 manifest.cos_url 直接下载（快），② 从此端点下载个人 .env 拖入目录
agentInstallPackRouter.get('/dotenv', async (req: Request, res: Response) => {
  // 1. 鉴权
  let userId: string | null = null;
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const u = session?.user;
    if (u && typeof u.id === 'string' && u.id.length > 0) userId = u.id;
  } catch (err) {
    console.warn('[install-pack/dotenv] session 解析失败:', err);
  }
  if (!userId) {
    return res.status(401).json({ ok: false, code: 'UNAUTHORIZED' });
  }

  // 2. 查 user 的 active license
  let licenseKey: string;
  try {
    const { rows } = await pool.query<{ license_key: string }>(
      `SELECT license_key
         FROM zenithjoy.licenses
        WHERE customer_id = $1 AND status = 'active'
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId]
    );
    if (rows.length === 0) {
      return res.status(503).json({
        ok: false,
        code: 'NO_ACTIVE_LICENSE',
        message: 'no active license bound to your account; 请回 Account 页确认',
      });
    }
    licenseKey = rows[0].license_key;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return res.status(500).json({ ok: false, code: 'DB_ERROR', message: msg });
  }

  // 3. 返回个人 .env（license + 本实例对外地址已烧入）
  // agent→staging 隔离：从 staging 域名取 dotenv 会带 staging URL，从生产取带生产 URL。
  const content = [`ZENITHJOY_LICENSE=${licenseKey}`, ...agentApiUrlEnvLines(), ''].join('\n');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=".env"');
  res.setHeader('Content-Length', String(Buffer.byteLength(content)));
  return res.status(200).send(content);
});

// 安卓 APK 分发 + 深链绑定信息（Line02 客户自助装机绑定第一刀）
// 复用 /download 同款 session 鉴权 + active license 查询；不改桌面 manifest。
agentInstallPackRouter.get('/android', async (req: Request, res: Response) => {
  // 1. 鉴权（同 /download）
  let userId: string | null = null;
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const u = session?.user;
    if (u && typeof u.id === 'string' && u.id.length > 0) userId = u.id;
  } catch (err) {
    console.warn('[install-pack/android] session 解析失败:', err);
  }
  if (!userId) {
    return res.status(401).json({ ok: false, code: 'UNAUTHORIZED' });
  }

  // 2. 查 active license（无则空串，仍返 apk_url 让客户先下包）
  let licenseKey = '';
  try {
    const { rows } = await pool.query<{ license_key: string }>(
      `SELECT license_key FROM zenithjoy.licenses
        WHERE customer_id = $1 AND status = 'active'
        ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    if (rows.length > 0) licenseKey = rows[0].license_key;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return res.status(500).json({ ok: false, code: 'DB_ERROR', message: msg });
  }

  // 3. apk_url（COS 常量）+ deeplink（api=ws url，安卓 deriveHttpBase 会 wss→https 做 register）
  const apkUrl =
    process.env.ANDROID_APK_COS_URL ||
    // TODO: 自定义域名 HTTPS 证书申请中(COS 免费证书需走腾讯云 SSL 证书流程,非即时生效)，暂用 HTTP
    'http://apk.zenjoymedia.media/install-pack/android/zenithjoy-agent.apk';
  const wsUrl = process.env.AGENT_PUBLIC_WS_URL || 'wss://api.zenithjoy.com/agent-ws';
  const parts = [`api=${encodeURIComponent(wsUrl)}`];
  if (licenseKey) parts.unshift(`license=${encodeURIComponent(licenseKey)}`);
  const deeplink = `zenithjoy://bind?${parts.join('&')}`;

  return res.status(200).json({
    apk_url: apkUrl,
    deeplink,
    license_key: licenseKey,
    version: '1.0.1',
  });
});
