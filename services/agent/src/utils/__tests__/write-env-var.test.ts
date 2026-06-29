import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeEnvVar } from '../write-env-var';

let tmpDir: string;
let envPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-env-var-test-'));
  envPath = path.join(tmpDir, '.env');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('writeEnvVar', () => {
  it('新建 .env 并写入 key=value', () => {
    writeEnvVar(envPath, 'ZJ_MAIN_DATA_DIR', 'C:\\Temp\\burner\\acct1');
    const content = fs.readFileSync(envPath, 'utf8');
    expect(content).toContain('ZJ_MAIN_DATA_DIR=C:\\Temp\\burner\\acct1');
  });

  it('已有 .env 但没有该 key → 追加', () => {
    fs.writeFileSync(envPath, 'ZENITHJOY_LICENSE=ZJ-F-TEST\n', 'utf8');
    writeEnvVar(envPath, 'ZJ_MAIN_DATA_DIR', 'C:\\Temp\\burner\\acct2');
    const content = fs.readFileSync(envPath, 'utf8');
    expect(content).toContain('ZENITHJOY_LICENSE=ZJ-F-TEST');
    expect(content).toContain('ZJ_MAIN_DATA_DIR=C:\\Temp\\burner\\acct2');
  });

  it('已有该 key → 替换而非重复追加', () => {
    fs.writeFileSync(envPath, 'ZJ_MAIN_DATA_DIR=old_value\nOTHER=x\n', 'utf8');
    writeEnvVar(envPath, 'ZJ_MAIN_DATA_DIR', 'new_value');
    const content = fs.readFileSync(envPath, 'utf8');
    expect(content).toContain('ZJ_MAIN_DATA_DIR=new_value');
    expect(content).not.toContain('old_value');
    expect(content).toContain('OTHER=x');
    expect(content.split('ZJ_MAIN_DATA_DIR=').length - 1).toBe(1);
  });

  it('.env 不存在时不抛异常，直接新建', () => {
    expect(() => writeEnvVar(envPath, 'FOO', 'bar')).not.toThrow();
    expect(fs.existsSync(envPath)).toBe(true);
  });
});
