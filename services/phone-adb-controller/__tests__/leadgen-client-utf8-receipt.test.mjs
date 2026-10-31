import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execInput} from '../leadgen-client.mjs';

test('RPC stdout 跨数据块的 UTF-8 中文保持原字节和回执摘要', async () => {
  const raw=JSON.stringify({status:'ok',reason:'实际视频采集完成，继续处理评论'})+'\n';
  const boundary=Buffer.from(raw).indexOf(Buffer.from('实'))+1;
  const child=`const b=Buffer.from(${JSON.stringify(raw)});process.stdout.write(b.subarray(0,${boundary}));setTimeout(()=>process.stdout.write(b.subarray(${boundary})),30)`;
  const result=await execInput(process.execPath,['-e',child],{timeoutMs:3000});
  assert.equal(result.code,0);
  assert.equal(result.stdout,raw);
  assert.equal(createHash('sha256').update(result.stdout).digest('hex'),createHash('sha256').update(raw).digest('hex'));
});
