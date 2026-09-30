// Commander 定位守卫（Brain 任务 81958796，决策 3c98fb36 阶段 2 / 018e4e84 同权 / e8f872cb 只服务 workflow）。
// 09-30 02:00–08:15 事故后主理人定案：Commander 先上岗、照调度单启动执行器、陪跑到 finalize、售后——
// 不选机器/手机、不编排、不起草契约；权限与有头会话同权（三档：自动做 / Bark 请示 / 只报不做），覆盖旧宪法「无杀权」。
// 这里钉住四份真身：宪法 COMMANDER.md、skill SKILL.md、work-commander 工作区 AGENTS.md（0930 起收进仓）、deploy.sh 落点。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(SRC, p), "utf8");

test("COMMANDER.md：第 1 条改为与有头会话同权 + 三档表，第 5 条危险动作并入 Bark 请示档，平滑收工有定义", () => {
  const law = read("COMMANDER.md");
  assert.match(law, /三档/, "宪法必须写明三档权限");
  assert.match(law, /与有头会话同权/, "第 1 条必须改为与有头会话同权（决策 018e4e84）");
  for (const tier of ["自动做", "Bark 请示", "只报不做"]) assert.match(law, new RegExp(tier), `三档缺「${tier}」`);
  assert.match(law, /平滑收工[^\n]*(放锁)[^\n]*(落池)[^\n]*(回桌面)[^\n]*(finalize)/, "平滑收工必须定义为：放锁、已采落池、回桌面、finalize partial");
  assert.doesNotMatch(law, /^1\. \*\*帮不拦，无杀权\*\*/m, "旧第 1 条「帮不拦，无杀权」必须被覆盖");
  assert.doesNotMatch(law, /^5\. \*\*危险动作绝不做\*\*/m, "旧第 5 条「危险动作绝不做」必须并入 Bark 请示档");
  assert.match(law, /只服务 workflow/, "Commander 只服务 workflow（决策 e8f872cb）");
  assert.doesNotMatch(law, /选能力\/机器\/手机/, "入口行不得再写 Commander 选能力/机器/手机");
});

test("workflow-commander SKILL.md：只照调度单执行，不选空闲手机、不起草契约", () => {
  const skill = read("commander/skills/workflow-commander/SKILL.md");
  assert.doesNotMatch(skill, /选空闲/, "不得再教 Commander 选空闲手机");
  assert.doesNotMatch(skill, /起草契约|起草新能力契约/, "不得再教 Commander 起草契约");
  assert.doesNotMatch(skill, /串新的 workflow/, "「串新的 workflow（组装）」整节必须删除");
  assert.match(skill, /调度单/, "必须定义调度单");
  assert.match(skill, /<能力> <机器> <profile> <serial> <biz>/, "调度单格式必须写死");
  assert.match(skill, /设计时/, "要组装新 workflow 必须指回设计时流程");
  for (const keep of ["hostname", "wf-status", "100.71.151.105", "退出码", "禁止说「预检已过」"]) {
    assert.ok(skill.includes(keep), `收窄不得误删仍有效条款: ${keep}`);
  }
});

test("AGENTS.md 真身进仓：只留身份/宪法指针/启动约定 + 两节铁律，n8n V4 协议全删", () => {
  const agents = read("commander/AGENTS.md");
  assert.match(agents, /\$workflow-commander/, "启动约定必须先加载 $workflow-commander");
  assert.match(agents, /wf-<能力>/, "启动约定必须再加载该 workflow 自己的陪跑 skill wf-<能力>");
  assert.match(agents, /COMMANDER\.md/, "必须指向宪法真身");
  assert.match(agents, /三档/, "必须提到三档权限");
  assert.match(agents, /只服务 workflow/, "身份：只服务 workflow");
  assert.match(agents, /## 跑场下放铁律/, "保留跑场下放铁律");
  assert.match(agents, /## 零等待铁律/, "保留零等待铁律");
  for (const dead of ["V4-SKELETON", "WORKFLOW_STAGE_REQUEST", "COMMANDER_STAGE_RESULT", "sessions_spawn", "workflow-state.mjs",
    "## Ownership", "## Startup contract", "## Stage loop", "## Lifecycle relay", "## Control messages", "agentic-workflow-runtime"]) {
    assert.ok(!agents.includes(dead), `n8n V4 协议残留: ${dead}`);
  }
  assert.ok(agents.split("\n").length < 70, `AGENTS.md 应当短（现 ${agents.split("\n").length} 行）`);
});

test("deploy.sh：AGENTS.md 同步到 MMV work-commander 工作区，改真身走 PR", () => {
  const deploy = read("deploy.sh");
  assert.match(deploy, /push_atomic "\$D\/commander\/AGENTS\.md" mmv "~\/openclaw-root\/workspaces-root\/clawd-work-commander" AGENTS\.md/);
});
