// Sprint 2.1e — 读 install pack manifest.json
import fs from 'node:fs';

export interface InstallPackManifest {
  version: string;
  sha256: string;
  download_url: string;
  cos_url?: string;
  size: number;
  build_time: string;
}

const DEFAULT_MANIFEST_PATH =
  process.env.INSTALL_PACK_MANIFEST_PATH ||
  '/opt/zenithjoy/install-pack/manifest.json';

export function readInstallPackManifest(
  filePath: string = DEFAULT_MANIFEST_PATH,
  strict = false
): InstallPackManifest | null {
  try {
    if (!fs.existsSync(filePath)) {
      if (strict && fs.existsSync(filePath + '.releases')) throw new Error('released manifest missing');
      return null;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as InstallPackManifest;
    if (
      typeof parsed.version === 'string' &&
      typeof parsed.sha256 === 'string' &&
      typeof parsed.download_url === 'string'
    ) {
      return parsed;
    }
    if (strict) throw new Error('invalid release manifest');
    return null;
  } catch (error) {
    if (strict) throw error;
    return null;
  }
}
