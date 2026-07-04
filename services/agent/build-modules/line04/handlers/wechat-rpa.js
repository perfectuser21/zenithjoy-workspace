"use strict";
// modules/line04/handlers/wechat-rpa.ts
//
// 从 services/agent/src/handlers/wechat-rpa.ts 迁移而来（sprint 06081700 模块化拆包）。
// 与原文件唯一区别：脚本/python 路径基于「模块目录」解析，而非 core.exe 同级目录。
// 模块安装后结构：<moduleDir>/{index.js, handlers/, wechat-rpa/<*.py>, python-embedded/python.exe}
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports._listenerKillFuncs = void 0;
exports.getModuleRoot = getModuleRoot;
exports.getModuleVersion = getModuleVersion;
exports.getPythonExeForTest = getPythonExeForTest;
exports.resolveScriptForTest = resolveScriptForTest;
exports.handleWechatRpa = handleWechatRpa;
exports._resetListenerBackoff = _resetListenerBackoff;
exports.resolveRealPublishEnv = resolveRealPublishEnv;
exports.buildListenerSpawnArgs = buildListenerSpawnArgs;
exports.isListenerAlive = isListenerAlive;
exports.appendListenChatLog = appendListenChatLog;
exports.startWechatListener = startWechatListener;
exports.defaultListenerHealthFile = defaultListenerHealthFile;
exports.collectListenerHealth = collectListenerHealth;
exports.buildHealthStatusMessage = buildHealthStatusMessage;
const node_child_process_1 = require("node:child_process");
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
// 模块根目录：编译后本文件位于 <moduleDir>/handlers/wechat-rpa.js，上一级即模块根。
function getModuleRoot() {
    return node_path_1.default.resolve(__dirname, '..');
}
// Phase 0 观测：读模块 manifest 版本，spawn 时经 env 传给 listen_chat → 上报心跳 diag，
// 让同事机器无 SSH 也能在中台看板确认跑的是哪版 line04。读不到返回 'unknown'，绝不抛。
function getModuleVersion() {
    try {
        const p = node_path_1.default.join(getModuleRoot(), 'manifest.json');
        return JSON.parse(node_fs_1.default.readFileSync(p, 'utf-8')).version || 'unknown';
    }
    catch {
        return 'unknown';
    }
}
// 测试用导出：允许注入 baseDir；bundled 模块含 python-embedded/python.exe。
// 若模块目录无 python-embedded，从 ZENITHJOY_CORE_DIR 找 core Agent 的 python-embedded。
function getPythonExeForTest(baseDir) {
    const embedded = node_path_1.default.join(baseDir, 'python-embedded', 'python.exe');
    if (node_fs_1.default.existsSync(embedded))
        return embedded;
    const coreDir = process.env.ZENITHJOY_CORE_DIR;
    if (coreDir) {
        const coreEmbedded = node_path_1.default.join(coreDir, 'python-embedded', 'python.exe');
        if (node_fs_1.default.existsSync(coreEmbedded))
            return coreEmbedded;
    }
    return process.platform === 'win32' ? 'python' : 'python3';
}
function getPythonExe() {
    return getPythonExeForTest(getModuleRoot());
}
// 测试专用导出：暴露路径解析逻辑（基于模块根目录的 wechat-rpa/）。
function resolveScriptForTest(type, rpaDir = node_path_1.default.join(getModuleRoot(), 'wechat-rpa')) {
    switch (type) {
        case 'wechat_private_chat_send': return node_path_1.default.join(rpaDir, 'send_chat.py');
        case 'wechat_qr_bind': return node_path_1.default.join(rpaDir, 'qr_bind.py');
        case 'wechat_moments_send': return node_path_1.default.join(rpaDir, 'send_moment.py');
        default: return node_path_1.default.join(rpaDir, 'send_chat.py');
    }
}
function resolveScript(task) {
    if (task.pythonStub)
        return task.pythonStub;
    return resolveScriptForTest(task.type);
}
async function handleWechatRpa(task) {
    return new Promise((resolve) => {
        const script = resolveScript(task);
        const py = (0, node_child_process_1.spawn)(getPythonExe(), [script], {
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, REAL_PUBLISH: '1' },
        });
        let stdout = '';
        let stderr = '';
        py.stdout.on('data', d => { stdout += d.toString(); });
        py.stderr.on('data', d => { stderr += d.toString(); });
        py.stdin.write(JSON.stringify({ type: task.type, payload: task.payload }) + '\n');
        py.stdin.end();
        py.on('close', code => {
            if (code !== 0) {
                return resolve({ ok: false, error: `python exit ${code}: ${stderr.slice(0, 200)}` });
            }
            try {
                const receipt = JSON.parse(stdout);
                resolve({ ok: true, receipt });
            }
            catch {
                resolve({ ok: false, error: `receipt parse fail: ${stdout.slice(0, 100)}` });
            }
        });
        py.on('error', e => {
            resolve({ ok: false, error: `spawn fail: ${e.message}` });
        });
    });
}
// listen_chat.py 持久监听一整天（24h）。默认 300s 会让监听 5 分钟后自动退出，
// 客户机无人值守就此停摆 —— 这是 v1.1.80 客户装完"发消息没反应"的根因。
const LISTENER_TIMEOUT_SEC = 86400;
// 监听进程退出/崩溃后重启退避阶梯（崩溃自愈，无需外部 watchdog / 计划任务）：
// 连续失败越拉越慢，防 spawn 级失败（可执行文件缺失/权限）狂 spawn 打满 CPU。
// exit 与 error 两分支共用（error 此前只打日志不重拉 → spawn 级失败监听永久死，会议室实锤）。
const LISTENER_BACKOFF_STEPS_MS = [30000, 60000, 120000, 300000];
// 子进程存活超此阈值视为"这次拉起是健康的"，下次失败退避计数器归零（从 30s 重新起）。
const LISTENER_HEALTHY_UPTIME_MS = 10 * 60000;
// 模块级连续失败计数器 + 上次 spawn 时间戳（供退避与健康重置）。
let _listenerFailCount = 0;
let _listenerSpawnedAt = 0;
// 防重入：child 崩溃常同时触发 error 与 exit（两分支都调 scheduleListenerRespawn），
// 无此 guard 会排两次重拉 → 双实例 / 退避被跳档。已排程时后续调用直接忽略，spawnOnce 里清零。
let _respawnScheduled = false;
// 测试用：重置退避状态（模块级 let 在多用例间会串，测试 beforeEach 调用清零）。
function _resetListenerBackoff() {
    _listenerFailCount = 0;
    _listenerSpawnedAt = 0;
    _respawnScheduled = false;
}
// ── 自愈件2：真发开关一处传 ──
// 长驻 listen_chat 出站给关键人真发读的是 REAL_PUBLISH；但 agent/模块配置里用的是
// ZENITHJOY_AGENT_REAL_PUBLISH（与按需 handler handleWechatRpa 注入 REAL_PUBLISH=1 不一致）。
// 这里把两个名归一：任一为 '1' 即视作开启，spawn 时显式注入 REAL_PUBLISH，确保长驻 listener
// 与按需 handler 一样能真发（配合 #821 让 listen_chat 同时兼容两名）。
function resolveRealPublishEnv(env = process.env) {
    const on = env.ZENITHJOY_AGENT_REAL_PUBLISH === '1' || env.REAL_PUBLISH === '1';
    return on ? '1' : '0';
}
// 测试用导出：构造 listen_chat.py 的 spawn 参数（含持久 --timeout，防"5分钟死"回归）。
// agentId 传入时追加 --agent-id，listen_chat.py 用它上报心跳 → Dashboard 显示机器名而非"未知客户端"。
// machineId 传入时追加 --machine-id，listen_chat.py 按它向中台拉「自己那份」每客服配置（决策 143f5d00）。
function buildListenerSpawnArgs(script, apiBase, agentId, machineId) {
    const args = [script, '--middleware-url', apiBase, '--timeout', String(LISTENER_TIMEOUT_SEC)];
    if (agentId)
        args.push('--agent-id', agentId);
    if (machineId)
        args.push('--machine-id', machineId);
    return args;
}
// 测试注入点：允许替换 spawnSync / spawn 实现和 platform（CJS 直接调同文件函数无法被 vi.spyOn 拦截）。
// killExistingListeners 在此对象上挂载，方便测试重置。
exports._listenerKillFuncs = {
    spawnFn: node_child_process_1.spawn,
    spawnSyncFn: node_child_process_1.spawnSync,
    platform: process.platform,
    // 启动新监听前查杀所有已运行的 listen_chat.py，防止多实例导致 Dashboard 出现重复客户端条目。
    // 仅 Windows 有效；wmic 失败时静默跳过（不阻塞启动）。
    killExistingListeners() {
        if (this.platform !== 'win32')
            return;
        try {
            const result = this.spawnSyncFn('wmic', [
                'process',
                'where',
                'CommandLine like "%listen_chat.py%"',
                'get',
                'ProcessId',
                '/FORMAT:LIST',
            ]);
            if (result.status !== 0 || !result.stdout)
                return;
            for (const line of result.stdout.split(/\r?\n/)) {
                const m = line.match(/^ProcessId=(\d+)/);
                if (!m)
                    continue;
                const pid = m[1];
                try {
                    this.spawnSyncFn('taskkill', ['/F', '/PID', pid]);
                    console.log(`[wechat-rpa] 已终止旧监听进程 PID ${pid}`);
                }
                catch {
                    // 进程已退出，忽略
                }
            }
        }
        catch {
            // wmic 不可用，跳过清理
        }
    },
};
// 自愈件4：listen_chat child 存活态追踪（spawn 后置 true，exit/error 置 false），
// 供 index.ts 的健康自检 loop 读取，合成模块真实健康上报 core。
let _listenerAlive = false;
function isListenerAlive() {
    return _listenerAlive;
}
// Sprint 0703-line04-desktop-lease-broker（部署缺口修复）：
// listen_chat.py stderr（含 desktop-lease-broker 的 [desktop_lease] 诊断行）此前只
// console.warn，没有任何地方落盘，无法观测。本函数把同一份内容旁路落盘到
// <AppData>/zenithjoy-agent/logs/listen-chat.log。不 import core 的 config-loader.ts
// （build-line-module.sh 只编译 modules/line04 下的文件，没有到 core src 的模块解析
// 路径），内联一份自包含的最小实现，跟本文件"模块目录/客户机路径自解析"的既有约定一致。
const DEFAULT_LOG_MAX_BYTES = 5 * 1024 * 1024; // 5MB
function getAgentLogDir() {
    const base = process.env.APPDATA
        ? node_path_1.default.join(process.env.APPDATA, 'zenithjoy-agent')
        : node_path_1.default.join(node_os_1.default.homedir(), 'AppData', 'Roaming', 'zenithjoy-agent');
    return node_path_1.default.join(base, 'logs');
}
function appendListenChatLog(chunk, opts) {
    try {
        const logDir = getAgentLogDir();
        node_fs_1.default.mkdirSync(logDir, { recursive: true });
        const logFile = node_path_1.default.join(logDir, 'listen-chat.log');
        const maxBytes = opts?.maxBytes ?? DEFAULT_LOG_MAX_BYTES;
        if (node_fs_1.default.existsSync(logFile) && node_fs_1.default.statSync(logFile).size > maxBytes) {
            node_fs_1.default.renameSync(logFile, node_path_1.default.join(logDir, 'listen-chat.log.old'));
        }
        node_fs_1.default.appendFileSync(logFile, chunk);
    }
    catch {
        // 磁盘满/权限问题绝不能让 listen_chat 崩溃——console.warn 已有兜底可见性。
    }
}
// Windows only：模块激活时自动拉起 listen_chat.py 持续监听微信消息。
// 先查杀所有旧 listen_chat.py 实例（防多条心跳/Dashboard 重复客户端），再 spawn 新进程。
// 持久（timeout 86400）+ 崩溃自愈（退出后 30s 自动重启），随模块生命周期常驻。
function startWechatListener(apiBase, agentId, machineId) {
    if (exports._listenerKillFuncs.platform !== 'win32') {
        console.log('[wechat-rpa] 非 Windows，跳过 listen_chat 自启');
        return;
    }
    const script = node_path_1.default.join(getModuleRoot(), 'wechat-rpa', 'listen_chat.py');
    // 查杀旧监听进程，确保干净环境
    exports._listenerKillFuncs.killExistingListeners();
    // 自愈件2：一处定真发开关 —— 把 agent 配置的真发态归一注入 REAL_PUBLISH（长驻 listener
    // 与按需 handler 一样能真发），同时保留 ZENITHJOY_AGENT_REAL_PUBLISH（配合 #821 兼容两名）。
    const realPublish = resolveRealPublishEnv(process.env);
    const spawnEnv = {
        ...process.env,
        REAL_PUBLISH: realPublish,
        ZENITHJOY_AGENT_REAL_PUBLISH: realPublish,
        ZENITHJOY_MODULE_VERSION: getModuleVersion(),
    };
    // exit 与 error 两分支共用的重拉调度：带连续失败退避 + 存活超阈值后计数器重置。
    // error 分支此前只置 _listenerAlive=false 打日志不重拉，spawn 级失败会永久死——这里统一治。
    const scheduleListenerRespawn = (reason) => {
        _listenerAlive = false;
        // 防重入：同一次崩溃的 error+exit 双事件只排一次重拉（spawnOnce 成功拉起后清零）。
        if (_respawnScheduled) {
            return;
        }
        _respawnScheduled = true;
        // 上次拉起若存活超健康阈值，视为稳定运行过，退避计数器归零（从最短间隔重新起）。
        const aliveMs = _listenerSpawnedAt ? Date.now() - _listenerSpawnedAt : 0;
        if (aliveMs >= LISTENER_HEALTHY_UPTIME_MS) {
            _listenerFailCount = 0;
        }
        const idx = Math.min(_listenerFailCount, LISTENER_BACKOFF_STEPS_MS.length - 1);
        const delay = LISTENER_BACKOFF_STEPS_MS[idx];
        _listenerFailCount += 1;
        console.warn(`[wechat-rpa] listen_chat.py ${reason}，${delay / 1000}s 后自动重启（崩溃自愈，第 ${_listenerFailCount} 次，退避 ${delay / 1000}s）`);
        setTimeout(() => {
            exports._listenerKillFuncs.killExistingListeners();
            spawnOnce();
        }, delay).unref?.();
    };
    const spawnOnce = () => {
        const child = exports._listenerKillFuncs.spawnFn(getPythonExe(), buildListenerSpawnArgs(script, apiBase, agentId, machineId), {
            detached: false,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            env: spawnEnv,
        });
        _listenerAlive = true;
        _listenerSpawnedAt = Date.now();
        _respawnScheduled = false; // 新监听已拉起，允许下次崩溃重新排程
        child.stdout.on('data', (d) => {
            console.log('[listen_chat]', d.toString().trim());
        });
        child.stderr.on('data', (d) => {
            const text = d.toString();
            console.warn('[listen_chat stderr]', text.trim());
            appendListenChatLog(text);
        });
        child.on('exit', (code) => {
            scheduleListenerRespawn(`退出(code=${code})`);
        });
        child.on('error', (err) => {
            scheduleListenerRespawn(`启动失败(${err?.message ?? err})`);
        });
    };
    spawnOnce();
    console.log('[wechat-rpa] listen_chat.py 持久监听已自启（middleware-url:', apiBase, '，timeout 86400 + 崩溃自愈）');
}
// 默认健康文件路径（与 listen_chat.py 约定一致，落 %PUBLIC%）。
function defaultListenerHealthFile() {
    const pub = process.env.PUBLIC || (process.platform === 'win32' ? 'C:\\Users\\Public' : '/tmp');
    return node_path_1.default.join(pub, 'zj-listener-health.json');
}
// 合成 listen_chat 真实健康：进程不在 → ok:false；进程在但微信窗口没找到 → ok:false。
// 健康文件缺失/损坏不抛，按进程存活态给保守结论（found_window 未知则不谎报 true）。
function collectListenerHealth(input) {
    const { listenerAlive } = input;
    let found_window;
    let last_delivery_ts;
    let login_present;
    let sessions_seen;
    const file = input.healthFile ?? defaultListenerHealthFile();
    try {
        if (node_fs_1.default.existsSync(file)) {
            const raw = JSON.parse(node_fs_1.default.readFileSync(file, 'utf-8'));
            if (typeof raw.found_window === 'boolean')
                found_window = raw.found_window;
            if (typeof raw.last_delivery_ts === 'number')
                last_delivery_ts = raw.last_delivery_ts;
            if (typeof raw.login_present === 'boolean')
                login_present = raw.login_present;
            if (typeof raw.sessions_seen === 'number')
                sessions_seen = raw.sessions_seen;
        }
    }
    catch {
        // 健康文件损坏：不抛，按保守结论
    }
    if (!listenerAlive) {
        return {
            ok: false,
            reason: 'listen_chat 进程不在（已退出，等待 supervise 重启）',
            listener_alive: false,
            found_window,
            last_delivery_ts,
            login_present,
            sessions_seen,
        };
    }
    // 进程在但微信主窗口没找到 → 不健康。按 login_present 给【精确】reason，中台直接看出是哪种：
    //  - 没登录 → 让客户扫码登录
    //  - 登录了但窗口找不到 → UIA 屏幕阅读器标志失效 / agent 与微信会话隔离(权限/Administrator) / 窗口最小化
    if (found_window === false) {
        const reason = login_present === true
            ? '微信已登录但 UIA 找不到主窗口（屏幕阅读器标志失效 / agent 与微信不在同一会话权限 / 窗口最小化）'
            : login_present === false
                ? '微信未登录（需在该机扫码登录）'
                : '微信主窗口未找到（未登录或 UIA 未就绪）';
        return {
            ok: false,
            reason,
            listener_alive: true,
            found_window: false,
            last_delivery_ts,
            login_present,
            sessions_seen,
        };
    }
    return { ok: true, listener_alive: true, found_window, last_delivery_ts, login_present, sessions_seen };
}
// 把合成健康打包成发给 core 的 IPC status 消息。
function buildHealthStatusMessage(h) {
    return {
        type: 'status',
        ok: h.ok,
        reason: h.reason,
        listener_alive: h.listener_alive,
        found_window: h.found_window,
        last_delivery_ts: h.last_delivery_ts,
    };
}
