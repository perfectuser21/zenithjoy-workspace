// services/agent/src/config-loader.ts
//
// Sprint 2.1f Fix 6 — envOrConfig loader (单独抽出，可单测)
//
// 优先级：
//   1. 环境变量 ZENITHJOY_LICENSE（start.bat 用 for /f 注入）
//   2. %APPDATA%/zenithjoy-agent/config.json（兼容旧 v1.0.0 / v1.1 客户）
//   3. 两者都没 → throw Error 提示去检查 .env 或重装 install pack

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface AgentConfig {
  licenseKey: string;
  agentId: string;
  apiUrl: string;
  loggedInAt: number;
  wsToken?: string;
  machineId?: string;
  registerApiUrl?: string;
  tier?: string;
  maxMachines?: number;
  agentUuid?: string; // H-2 Bug 9: register 返的 agents.id (UUID), WS hello 携带复用 row
}

function getConfigDir(): string {
  // Always honour APPDATA if set — allows test isolation on any platform
  // (tests set process.env.APPDATA = tmpdir to avoid polluting real config)
  if (process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'zenithjoy-agent');
  }
  if (process.platform === 'win32') {
    return path.join(path.join(os.homedir(), 'AppData', 'Roaming'), 'zenithjoy-agent');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'zenithjoy-agent');
  }
  return path.join(os.homedir(), '.config', 'zenithjoy-agent');
}

export function loadOrInitConfig(): AgentConfig {
  // Priority 1: environment variable (injected by start.bat via for /f .env parsing)
  const envLicense = process.env.ZENITHJOY_LICENSE;
  if (envLicense && envLicense.trim()) {
    const apiUrl =
      process.env.ZENITHJOY_API_URL ||
      process.env.ZENITHJOY_API_BASE ||
      'wss://api.zenithjoy.com/agent-ws';
    return {
      licenseKey: envLicense.trim(),
      agentId: `agent-env-${Date.now().toString(36)}`,
      apiUrl,
      loggedInAt: Date.now(),
    };
  }

  // Priority 2: %APPDATA%/zenithjoy-agent/config.json fallback (legacy v1.0.0 customers)
  const configFile = path.join(getConfigDir(), 'config.json');
  if (fs.existsSync(configFile)) {
    try {
      const raw = fs.readFileSync(configFile, 'utf-8');
      const cfg = JSON.parse(raw) as Partial<AgentConfig>;
      if (cfg.licenseKey) {
        return cfg as AgentConfig;
      }
    } catch {
      // fall through to error
    }
  }

  // Neither env nor config.json — cannot start
  throw new Error(
    'No ZENITHJOY_LICENSE found. Please check .env ZENITHJOY_LICENSE or re-download install pack from dashboard.'
  );
}
