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
  '/opt/zenithjoy/autopilot-dashboard/dist/download/manifest.json';

export function readInstallPackManifest(
  filePath: string = DEFAULT_MANIFEST_PATH
): InstallPackManifest | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as InstallPackManifest;
    if (
      typeof parsed.version === 'string' &&
      typeof parsed.sha256 === 'string' &&
      typeof parsed.download_url === 'string'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
