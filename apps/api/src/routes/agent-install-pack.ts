// Sprint 2.1e — install pack manifest endpoint
// Sprint 2.1f Fix 7 — download handler server-side license burn-in 重写
import { Router, type Request, type Response } from 'express';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fromNodeHeaders } from 'better-auth/node';
import pool from '../db/connection';
import { auth } from '../auth';
import { readInstallPackManifest } from '../services/install-pack-manifest';

// 从远端 URL 下载 tar.gz 到本地路径，原子写（先 .downloading 再 rename）
// 用于 INSTALL_PACK_REMOTE_URL fallback：本地文件不存在时自动拉取并缓存
function downloadFileToPath(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tmp = dest + '.downloading';
    // 若上次下载中断留下 .downloading，先删掉
    fs.rmSync(tmp, { force: true });
    const file = fs.createWriteStream(tmp);
    const protocol = url.startsWith('https://') ? https : http;
    protocol.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.destroy();
        fs.rmSync(tmp, { force: true });
        reject(new Error(`remote fetch ${url} → HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          fs.renameSync(tmp, dest);
          resolve();
        });
      });
    }).on('error', (err) => {
      file.destroy();
      fs.rmSync(tmp, { force: true });
      reject(err);
    });
  });
}

export const agentInstallPackRouter = Router();

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
  // download_url 形如 /download/zenithjoy-agent-v1.0.1.tar.gz
  // 静态根目录从 manifest 路径推：默认 /opt/zenithjoy/autopilot-dashboard/dist
  const STATIC_ROOT =
    process.env.INSTALL_PACK_STATIC_ROOT ||
    '/opt/zenithjoy/autopilot-dashboard/dist';
  const srcTar = process.env.INSTALL_PACK_FIXTURE_PATH || // test override
    path.join(STATIC_ROOT, m.download_url.replace(/^\/+/, ''));
  if (!fs.existsSync(srcTar)) {
    // Fallback：本地文件不存在时，尝试从 INSTALL_PACK_REMOTE_URL 拉取并缓存
    // 适用场景：Mac Mini 本地没有 tar.gz，但 HK VPS nginx 上有完整文件
    const remoteUrl = process.env.INSTALL_PACK_REMOTE_URL;
    if (remoteUrl) {
      console.log(`[install-pack/download] 本地 tar.gz 不存在，从远端拉取: ${remoteUrl}`);
      try {
        fs.mkdirSync(path.dirname(srcTar), { recursive: true });
        await downloadFileToPath(remoteUrl, srcTar);
        console.log(`[install-pack/download] 远端拉取成功，已缓存到 ${srcTar}`);
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
    spawnSync('tar', ['-xzf', srcTar, '-C', tmp], { stdio: 'pipe' });
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
    const r = spawnSync('tar', tarArgs, { stdio: 'pipe' });
    if (r.status !== 0) {
      throw new Error(`tar repack failed: ${r.stderr.toString()}`);
    }

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
