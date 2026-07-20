/**
 * Vitest global setup: creates a symlink so that setup-reset-ps1-contract.test.ts
 * path resolution works correctly.
 *
 * Background: the contract test (at install-pack/__tests__/setup-reset-ps1-contract.test.ts)
 * computes REPO_ROOT as resolve(__dirname, '../../..').
 * __dirname = /workspace/services/agent/install-pack/__tests__
 * 3 levels up = /workspace/services
 * So REPO_ROOT = /workspace/services
 *
 * The test then looks for:
 *   resolve(REPO_ROOT, 'services/agent/install-pack/setup-reset.ps1')
 *   = /workspace/services/services/agent/install-pack/setup-reset.ps1
 *
 * Actual file location: /workspace/services/agent/install-pack/setup-reset.ps1
 *
 * Fix: create symlink /workspace/services/services -> /workspace/services
 * so Node.js resolves the path correctly via the symlink.
 */

import { symlinkSync, existsSync, unlinkSync } from 'fs';
import { resolve } from 'path';

// /workspace/services (parent of this file's directory)
const WORKSPACE_SERVICES = resolve(__dirname, '..');
// /workspace/services/services
const SYMLINK_PATH = resolve(WORKSPACE_SERVICES, 'services');

export function setup() {
  if (!existsSync(SYMLINK_PATH)) {
    // Use 'dir' on Linux/Mac, 'junction' on Windows
    const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
    symlinkSync(WORKSPACE_SERVICES, SYMLINK_PATH, symlinkType);
    console.log('[globalSetup] created /workspace/services/services symlink for contract test path fix');
  }
}

export function teardown() {
  if (existsSync(SYMLINK_PATH)) {
    unlinkSync(SYMLINK_PATH);
    console.log('[globalSetup] removed /workspace/services/services symlink');
  }
}
