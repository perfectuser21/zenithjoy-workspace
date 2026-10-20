import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {execInput} from '../leadgen-client.mjs';
import {readNativeOperation, receiptPath} from '../native-operation-receipt.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixture = fileURLToPath(new URL('./fixtures/native-operation-coverage.py', import.meta.url));
const readbackCli = fileURLToPath(new URL('../native-operation-receipt.mjs', import.meta.url));
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
function heartbeatCount(oracle) {
  const path = join(oracle, 'heartbeat.jsonl');
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).length : 0;
}

test('正常父命令结果与原生全集合停止证明分开：doublefork后台仍活不能获停止正证',
  {skip: process.platform === 'win32'}, async t => {
    const dir = mkdtempSync(join(tmpdir(), 'native-coverage-'));
    const oracle = join(dir, 'independent-oracle'), runDir = join(dir, 'product-run');
    mkdirSync(oracle, {mode: 0o700}); mkdirSync(runDir, {mode: 0o700});
    const python = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], {encoding: 'utf8'});
    assert.equal(python.status, 0, '真实fork fixture依赖的Python必须可用，不能setup失败冒红');
    const receipt = {runDir, operationId: 'background-resource', runId: 'coverage-run',
      taskId: 'coverage-task', profile: 'coverage-profile', serial: 'NO-DEVICE',
      sourceCommit: 'a'.repeat(40), owner: 'coverage-owner', activity: 'collect_videos'};
    const startedAt = Date.now(); let result, error;
    try {
      // 只传原execInput接口。oracle子PID仅在独立文件供断言读取，不注入产品追踪集合。
      try {
        result = await execInput(python.stdout.trim(), [fixture, oracle], {receipt, timeoutMs: 3000});
      } catch (caught) { error = caught; }
      const first = heartbeatCount(oracle);
      await sleep(250);
      const second = heartbeatCount(oracle);
      assert.ok(first > 0 && second > first, '父返回后逃逸子必须仍真实心跳，否则本case未覆盖活逃逸');
      const independent = readJson(join(oracle, 'identity.json'));
      const raw = readJson(receiptPath(runDir, receipt.operationId));
      assert.notEqual(independent.pgid, raw.pgid, '后台已脱离原命令进程组');
      assert.equal(independent.stdio_closed, true);
      assert.ok(raw.start_identity, '原父须真实登记启动身份，不能仅测试初次登记失败');
      assert.equal(raw.processes.find(p => p.pid === raw.pid)?.termination?.confirmed, true,
        '原父逐PID正向终态成立，才能区分已知集合终态与全集合覆盖');

      await t.test('允许正常命令交出code0结果，后台存在不把命令结果一律改为UNKNOWN异常', () => {
        assert.equal(error, undefined, '正常命令结果与全集合停止unknown应是两个轴');
        assert.equal(result?.code, 0);
      });
      await t.test('已知父确认停止不代表逃逸子全集合停止，独立readback必须保守', () => {
        assert.equal(raw.execution_stopped, false, '生产收据本身也不得宣称全集合停止，不能只让无绑定读回失败');
        const proof = readNativeOperation(runDir, receipt.operationId);
        assert.equal(proof.execution_stopped, false, '活逃逸子存在，不能用observed PID终态冒全集合正证');
        const cli = spawnSync(process.execPath,
          [readbackCli, 'readback', '--run-dir', runDir, '--operation-id', receipt.operationId],
          {encoding: 'utf8', timeout: 3000});
        assert.equal(cli.status, 1, '正式只读入口同样不得返回停止正证');
        assert.equal(JSON.parse(cli.stdout).execution_stopped, false);
      });
    } finally {
      // 只等fixture自己的五秒TTL，不对oracle PID/未知PID发停止信号。
      while (!existsSync(join(oracle, 'ttl-exit.json')) && Date.now() - startedAt < 8000) await sleep(100);
      assert.equal(existsSync(join(oracle, 'ttl-exit.json')), true, 'fixture必须自行退出，不能遗留后台资源');
      assert.equal(readJson(join(oracle, 'ttl-exit.json')).reason, 'fixture_5s_ttl');
      rmSync(dir, {recursive: true, force: true});
    }
  });
