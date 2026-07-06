"use strict";
// modules/line04/preflight.ts
//
// line04 微信AI客服模块 — 真实环境预检（自包含，不依赖 core 源码，可独立打包）。
// 三项检测，失败给客户看得懂的中文 fixGuide：
//   1. 微信版本锁 4.1.8.x（只认 head==[4,1,8]）：<4.1.8 控件配方不一致/无 mmui::MainWindow；
//      >=4.1.9（含 4.1.10）控件适配未做 + 重启自升锁不住 → 一律不支持，触发 installWeChat 降级到 4.1.8。
//   2. python -c "import pywinauto" 可成功（驱动微信自动化的底层库）
//   3. 可用内存 ≥ 4GB
//
// 降级后强版关更新（wechat_update_lock.py）锁住，重启不自升回 4.1.10；没真锁死 → preflight 诚实报红。
// 非 Windows 平台：所有检测跳过并视为通过（ok:true），不崩溃。
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports._repairFuncs = exports.PIP_INDEX_URL = exports.GET_PIP_URL = exports.DELIVERY_SELFCHECK_INTERVAL_SEC = exports.WECHAT_DOWNLOAD_URL = void 0;
exports.parseVersionParts = parseVersionParts;
exports.isWechatVersionSupported = isWechatVersionSupported;
exports.parseWechatVersionFromRegOutput = parseWechatVersionFromRegOutput;
exports.wechatFixGuide = wechatFixGuide;
exports.pywinautoFixGuide = pywinautoFixGuide;
exports.memoryFixGuide = memoryFixGuide;
exports.checkWechatVersion = checkWechatVersion;
exports.checkPywinauto = checkPywinauto;
exports.checkMemory = checkMemory;
exports.checkWechatRunning = checkWechatRunning;
exports.interpretVerifySilent = interpretVerifySilent;
exports.checkVerifySilent = checkVerifySilent;
exports.shouldRunDeliverySelfcheck = shouldRunDeliverySelfcheck;
exports.deliverySelfcheckStampPath = deliverySelfcheckStampPath;
exports.readDeliveryLastRun = readDeliveryLastRun;
exports.writeDeliveryLastRun = writeDeliveryLastRun;
exports.interpretVerifyDelivery = interpretVerifyDelivery;
exports.checkVerifyDelivery = checkVerifyDelivery;
exports.downloadFile = downloadFile;
exports.interpretUpdateLock = interpretUpdateLock;
exports.buildElevatedLockArgs = buildElevatedLockArgs;
exports.lockWechatUpdate = lockWechatUpdate;
exports.installWeChat = installWeChat;
exports.installPywinauto = installPywinauto;
exports.autoRepair = autoRepair;
exports.getModulePython = getModulePython;
exports.runPreflight = runPreflight;
exports.buildOkReason = buildOkReason;
const node_child_process_1 = require("node:child_process");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_https_1 = __importDefault(require("node:https"));
// 旧版微信 COS 直链下载地址（客户降级用）。
exports.WECHAT_DOWNLOAD_URL = 'https://zenithjoy-static-1333590468.cos.accelerate.myqcloud.com/install-pack/wechat/WeChatWin_4.1.8.exe';
// 受支持微信版本：锁 4.1.8.x（decision 3bb16367，2026-06-29 反转 6-24「放开上界」）。
//   < 4.1.8（含 3.x / 4.0.x / 4.1.0~4.1.7）：控件配方不一致 / 无 mmui::MainWindow，RPA 不可用；
//   >= 4.1.9（含 4.1.10+）：UIA 机制虽一样，但新版控件适配未做（登录检测误报 / 自愈不自动登录 /
//     会话回顶找不到导航按钮）+ 重启自动升级锁不住。4.1.8 已全适配验证（rog 真发 DELIVERED），
//     统一锁死 4.1.8.x + 关自动更新，全网同一标准态。
// 与 wechat-rpa/find_weixin.py（MIN_REQUIRED=(4,1,8) 下界 + MIN_BLOCKED=(4,1,9) 上界 = 只认 4.1.8.x）、
//   config.py（WECHAT_MIN=(4,1,8) / WECHAT_MAX=(4,1,8,999)）一致，杜绝「一处放行一处拒」裂缝。
const SUPPORTED_VERSION = [4, 1, 8];
const MIN_MEMORY_BYTES = 4 * 1024 ** 3;
// ---------- 纯函数：版本解析与比较 ----------
// 把版本字符串拆成数字段（缺失/非法段按 0 处理）。
function parseVersionParts(version) {
    return version
        .trim()
        .split('.')
        .map((n) => {
        const v = parseInt(n, 10);
        return Number.isFinite(v) ? v : 0;
    });
}
// 锁 4.1.8.x（decision 3bb16367，2026-06-29 反转 6-24）：只认 head==[4,1,8]，patch 段后的 build 号不限。
// >=4.1.9（含 4.1.10）一律不支持 → 触发 installWeChat 卸载降级到 4.1.8。理由：4.1.10 控件适配未做 +
// 微信版本碎片化运维不可控，客户机统一锁死 4.1.8 + 关自动更新，全网同一标准态。
function isWechatVersionSupported(version) {
    const parts = parseVersionParts(version);
    const head = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
    return head[0] === SUPPORTED_VERSION[0]
        && head[1] === SUPPORTED_VERSION[1]
        && head[2] === SUPPORTED_VERSION[2]; // == 4.1.8.x
}
// WeChat/Weixin DWORD 有两种编码：
//   3.x（高字节 = 0x60+major）：4.1.8.107 → 0x6401086b
//   4.x（nibble-packed，byte0 ≥ 0x70）：4.1.8.107 → 0xf254186b
//     byte[1] 低 4 位 = major, byte[2] 高 4 位 = minor, byte[2] 低 4 位 = patch, byte[3] = build
// 实测：xian-rog HKCU\SOFTWARE\Tencent\Weixin Version = 0xf254186b（Weixin 4.1.8.107 安装）
function decodeWechatDword(hex) {
    const num = parseInt(hex, 16) >>> 0;
    const byte0 = (num >> 24) & 0xff;
    if (byte0 >= 0x70) {
        // Weixin 4.x nibble-packed encoding
        const major = (num >> 16) & 0x0f;
        const minor = (num >> 12) & 0x0f;
        const patch = (num >> 8) & 0x0f;
        const build = num & 0xff;
        return `${major}.${minor}.${patch}.${build}`;
    }
    // WeChat 3.x offset encoding: byte0 = major + 0x60
    const major = byte0 - 0x60;
    const minor = (num >> 16) & 0xff;
    const patch = (num >> 8) & 0xff;
    const build = num & 0xff;
    return `${major}.${minor}.${patch}.${build}`;
}
// 解析 `reg query ... /v Version` 的 stdout，返回点分版本号；解析不出返回 null。
// 兼容 REG_SZ（字符串）与 REG_DWORD（十六进制编码）两种存法。
function parseWechatVersionFromRegOutput(output) {
    const m = output.match(/Version\s+REG_\w+\s+(\S+)/i);
    if (!m)
        return null;
    const raw = m[1];
    if (/^0x[0-9a-f]+$/i.test(raw)) {
        return decodeWechatDword(raw);
    }
    return raw;
}
// ---------- 中文修复指引 ----------
function wechatFixGuide(found) {
    return `微信版本 ${found} 不支持（只认 4.1.8.x；<4.1.8 控件不可用，>=4.1.9 含 4.1.10 适配未做 + 锁不住自动更新）。` +
        `请安装 4.1.8：${exports.WECHAT_DOWNLOAD_URL}`;
}
function pywinautoFixGuide(errMessage) {
    return `缺少 pywinauto 依赖（错误：${errMessage}）。请联系技术支持。`;
}
function memoryFixGuide() {
    const gb = (node_os_1.default.totalmem() / 1024 ** 3).toFixed(1);
    return `当前内存 ${gb}GB 不足 4GB，请关闭其他程序后重试。`;
}
// 检测 1：微信版本。MOCK_WECHAT_VERSION env 可在任何平台注入版本号（跳过注册表读取）。
// 非 Windows 且无 MOCK 时跳过（视为通过）。
function checkWechatVersion() {
    const mockVersion = process.env.MOCK_WECHAT_VERSION;
    if (mockVersion) {
        if (isWechatVersionSupported(mockVersion))
            return { ok: true, found: mockVersion };
        return { ok: false, found: mockVersion, fixGuide: wechatFixGuide(mockVersion) };
    }
    if (process.platform !== 'win32') {
        return { ok: true, skipped: true };
    }
    // 优先读取 exe 文件版本（比注册表可靠：WeChat 4.1.8 启动后会把注册表版本改写为可用更新版本，
    // 但 exe FileVersion 始终是实际安装版本，不受自动更新检测器影响）。
    const exePaths = [
        'C:\\Program Files\\Tencent\\Weixin\\Weixin.exe',
        'C:\\Program Files\\Tencent\\WeChat\\WeChat.exe',
    ];
    for (const exePath of exePaths) {
        try {
            const out = (0, node_child_process_1.execSync)(`powershell -NoProfile -NonInteractive -Command "(Get-Item '${exePath}').VersionInfo.FileVersion"`, { encoding: 'utf-8', windowsHide: true, timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] });
            const v = out.trim();
            if (v && /^\d+\.\d+/.test(v)) {
                if (isWechatVersionSupported(v))
                    return { ok: true, found: v };
                return { ok: false, found: v, fixGuide: wechatFixGuide(v) };
            }
        }
        catch {
            // exe 不存在或 PowerShell 出错，继续尝试注册表
        }
    }
    const keys = [
        // 4.x（Weixin）— HKCU 下存版本，HKLM WOW6432Node 有时也有
        'HKCU\\SOFTWARE\\Tencent\\Weixin',
        'HKLM\\SOFTWARE\\WOW6432Node\\Tencent\\Weixin',
        'HKLM\\SOFTWARE\\Tencent\\Weixin',
        // 3.x（WeChat）
        'HKLM\\SOFTWARE\\WOW6432Node\\Tencent\\WeChat',
        'HKLM\\SOFTWARE\\Tencent\\WeChat',
        'HKCU\\SOFTWARE\\Tencent\\WeChat',
    ];
    for (const key of keys) {
        try {
            const out = (0, node_child_process_1.execSync)(`reg query "${key}" /v Version`, {
                encoding: 'utf-8',
                windowsHide: true,
                timeout: 10000,
                stdio: ['ignore', 'pipe', 'ignore'],
            });
            const v = parseWechatVersionFromRegOutput(out);
            if (v) {
                if (isWechatVersionSupported(v))
                    return { ok: true, found: v };
                return { ok: false, found: v, fixGuide: wechatFixGuide(v) };
            }
        }
        catch {
            // 该注册表键不存在或无权访问（runner 以 SYSTEM 运行时 HKCU 不可见），尝试下一个
        }
    }
    // 注册表全部查不到，退而检查安装目录下的版本子文件夹。
    // WeChat 3.x → C:\Program Files\Tencent\WeChat\[X.Y.Z.B]\
    // Weixin 4.x → C:\Program Files\Tencent\Weixin\X.Y.Z.B\
    const installDirs = [
        'C:\\Program Files\\Tencent\\Weixin', // 4.x（Weixin）
        'C:\\Program Files\\Tencent\\WeChat', // 3.x（WeChat）64-bit
        'C:\\Program Files (x86)\\Tencent\\WeChat', // 3.x（WeChat）32-bit
    ];
    for (const dir of installDirs) {
        if (!node_fs_1.default.existsSync(dir))
            continue;
        try {
            const entries = node_fs_1.default.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory())
                    continue;
                // 目录名格式：[3.9.12.51] 或直接 3.9.12.51
                const clean = entry.name.replace(/^\[|\]$/g, '');
                if (/^\d+\.\d+\.\d+/.test(clean)) {
                    if (isWechatVersionSupported(clean))
                        return { ok: true, found: clean };
                    return { ok: false, found: clean, fixGuide: wechatFixGuide(clean) };
                }
            }
        }
        catch {
            // 目录无法读取，跳过
        }
    }
    return {
        ok: false,
        fixGuide: `未检测到受支持的微信安装（需已安装微信桌面版且版本 == 4.1.8.x）。` +
            `如需安装 4.1.8：${exports.WECHAT_DOWNLOAD_URL}`,
    };
}
// 检测 2：pywinauto 可 import。spawn python -c "import pywinauto"，退出码 0 = 通过。
// MOCK_WECHAT_VERSION 设置时进入 CI mock 模式，跳过此检测（与非 Windows 行为一致）。
function checkPywinauto(pythonPath) {
    if (process.platform !== 'win32' || process.env.MOCK_WECHAT_VERSION || process.env.MOCK_PYWINAUTO_OK) {
        return Promise.resolve({ ok: true, skipped: true });
    }
    return new Promise((resolve) => {
        let settled = false;
        const done = (r) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve(r);
        };
        let child;
        try {
            child = (0, node_child_process_1.spawn)(pythonPath, ['-c', 'import pywinauto; print("ok")'], {
                windowsHide: true,
                stdio: ['ignore', 'ignore', 'ignore'],
            });
        }
        catch (e) {
            return resolve({ ok: false, fixGuide: pywinautoFixGuide(e.message) });
        }
        const timer = setTimeout(() => {
            try {
                child.kill();
            }
            catch {
                // ignore
            }
            done({ ok: false, fixGuide: pywinautoFixGuide('检测超时（Python 环境可能异常）') });
        }, 15000);
        child.on('error', (err) => {
            done({ ok: false, fixGuide: pywinautoFixGuide(err.message) });
        });
        child.on('close', (code) => {
            if (code === 0) {
                done({ ok: true });
            }
            else {
                done({ ok: false, fixGuide: pywinautoFixGuide(`python -c "import pywinauto" 退出码 ${code}`) });
            }
        });
    });
}
// 检测 3：内存 ≥ 4GB。非 Windows 跳过（视为通过）。MOCK_WECHAT_VERSION 时也跳过（CI mock 模式）。
function checkMemory() {
    if (process.platform !== 'win32' || process.env.MOCK_WECHAT_VERSION) {
        return { ok: true, skipped: true };
    }
    if (node_os_1.default.totalmem() >= MIN_MEMORY_BYTES)
        return { ok: true };
    return { ok: false, fixGuide: memoryFixGuide() };
}
// 检测 4（软检测）：微信进程是否在跑。
// WeChat 4.1.8 启动后主进程是 WeChatAppEx.exe（WeChat.exe 是启动器，随即退出）。
// 非 Windows 跳过。ok 始终为 true——未跑只给用户提示，不阻塞模块激活。
function checkWechatRunning() {
    if (process.platform !== 'win32')
        return { ok: true, skipped: true };
    // 两条命令均为字面量，无模板变量，无命令注入风险。
    const queries = [
        ['tasklist /FI "IMAGENAME eq WeChat.exe" /FO LIST', /WeChat\.exe/i],
        ['tasklist /FI "IMAGENAME eq WeChatAppEx.exe" /FO LIST', /WeChatAppEx\.exe/i],
    ];
    for (const [cmd, pattern] of queries) {
        try {
            const out = (0, node_child_process_1.execSync)(cmd, {
                encoding: 'utf-8',
                windowsHide: true,
                timeout: 10000,
                stdio: ['ignore', 'pipe', 'ignore'],
            });
            if (pattern.test(out))
                return { ok: true };
        }
        catch {
            // 该进程不存在或无权查询，继续下一个
        }
    }
    return {
        ok: true,
        fixGuide: '微信未运行，请打开微信并登录，Agent 将在 30 秒内自动连接。',
    };
}
// ---------- 静默接缝自检：--verify-silent --no-send（只读，不发消息）----------
// 从 listen_chat 输出里取最后一行合法 JSON（emit_json 打在最后）。解析不出返回 null。
function parseLastJsonLine(stdout) {
    const lines = (stdout || '')
        .trim()
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        if (line.startsWith('{') && line.endsWith('}')) {
            try {
                return JSON.parse(line);
            }
            catch {
                // 继续向上找
            }
        }
    }
    return null;
}
// 解析 listen_chat.py --verify-silent --no-send 的退出码 + 输出 → 检测结论（纯函数，CI 可测）。
//   silent:true            → ok（SILENT，窗口持续屏外）
//   silent:false           → 红（NOT SILENT，真接缝失败）
//   error 含环境未就绪关键词 → skip（微信未登录/未装/非Windows/pywinauto 缺）→ 不误判红
//   解析不出（空/乱码）     → skip（不误判红）
function interpretVerifySilent(exitCode, stdout) {
    const parsed = parseLastJsonLine(stdout);
    if (parsed && typeof parsed.error === 'string') {
        const err = parsed.error;
        if (/NO_WINDOW|未登录|必须在 Windows|pywinauto|找不到.*微信|找不到目标会话/.test(err)) {
            return { ok: true, skipped: true, found: err };
        }
        return { ok: false, fixGuide: `静默自检异常：${err}` };
    }
    if (parsed && parsed.silent === true) {
        return { ok: true, found: 'SILENT' };
    }
    if (parsed && parsed.silent === false) {
        const worst = parsed.worst_left;
        return {
            ok: false,
            found: 'NOT_SILENT',
            fixGuide: `微信窗口未持续屏外（NOT SILENT，worst_left=${worst}）— ` +
                `检查 OFFSCREEN_X 几何推导 / 窗口是否被最小化。`,
        };
    }
    // exitCode 仅作兜底参考；解析不出一律 skip 不误判红
    void exitCode;
    return { ok: true, skipped: true };
}
// 跑只读静默自检：spawn 内嵌 python 执行 listen_chat.py --verify-silent --no-send。
// MOCK_VERIFY_SILENT env 可在任何平台注入（silent/not_silent/skip）；非 Windows 无 MOCK 时 skip。
function checkVerifySilent(moduleDir) {
    const mock = process.env.MOCK_VERIFY_SILENT;
    if (mock === 'silent')
        return { ok: true, found: 'SILENT' };
    if (mock === 'not_silent') {
        return {
            ok: false,
            found: 'NOT_SILENT',
            fixGuide: '微信窗口未持续屏外（NOT SILENT）— 检查 OFFSCREEN_X / 是否被最小化。',
        };
    }
    if (mock === 'skip')
        return { ok: true, skipped: true };
    if (process.platform !== 'win32')
        return { ok: true, skipped: true };
    const dir = moduleDir ?? __dirname;
    const python = getModulePython(dir);
    const script = node_path_1.default.join(dir, 'wechat-rpa', 'listen_chat.py');
    if (!node_fs_1.default.existsSync(script)) {
        return { ok: true, skipped: true, found: 'listen_chat.py 缺失，跳过静默自检' };
    }
    try {
        const r = (0, node_child_process_1.spawnSync)(python, [script, '--verify-silent', '--no-send', '--silent-sample-seconds', '2'], { encoding: 'utf-8', windowsHide: true, timeout: 30000 });
        const exitCode = typeof r.status === 'number' ? r.status : 1;
        const stdout = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
        return interpretVerifySilent(exitCode, stdout);
    }
    catch (e) {
        // spawn 失败（python 缺等）→ skip 不误判红
        return { ok: true, skipped: true, found: `静默自检无法运行：${e.message}` };
    }
}
// ---------- 真送达自检节流：默认 1 小时一次（远程确认微信在线）----------
// 背景：带发送自检（checkVerifyDelivery）会主动发一条到「文件传输助手」远程确认在线，
// 但它随 runPreflight 触发，而 runPreflight 可能被频繁拉起（心跳门禁 / agent 重启 /
// 升级重试 / 崩溃自愈 / 多进程），用户体感「几秒~几分钟就发一次文件传输助手」。
// 故把这一条（且仅这一条主动发送）节流到默认 1 小时一次；只读静默自检（checkVerifySilent
// --no-send，被动心跳）不受影响，仍每次跑保证及时。
// 时间戳必须落盘（preflight.js 每次是新 spawn 进程 + agent 会重启，内存计数不管用）。
exports.DELIVERY_SELFCHECK_INTERVAL_SEC = 3600;
const DELIVERY_SELFCHECK_INTERVAL_MS = exports.DELIVERY_SELFCHECK_INTERVAL_SEC * 1000;
// 纯函数（CI 单测锚点）：距上次真送达自检是否已到间隔（到点才 true）。
// lastMs<=0 / 非法（从未跑过）→ true（首次必发）；now-last>=间隔 → true；否则 false。
function shouldRunDeliverySelfcheck(nowMs, lastMs, intervalMs = DELIVERY_SELFCHECK_INTERVAL_MS) {
    if (!Number.isFinite(lastMs) || lastMs <= 0)
        return true;
    return nowMs - lastMs >= intervalMs;
}
// 节流时间戳落盘路径（Windows: C:\Users\Public；其它平台回退 os.tmpdir()）。
function deliverySelfcheckStampPath() {
    const base = process.env.PUBLIC || node_os_1.default.tmpdir();
    return node_path_1.default.join(base, 'zj-delivery-selfcheck.json');
}
// 读上次真送达自检时间戳（ms）。读不到 / 解析失败 / 非法 → 0（视为从未跑过）。
function readDeliveryLastRun(stampPath = deliverySelfcheckStampPath()) {
    try {
        const raw = node_fs_1.default.readFileSync(stampPath, 'utf-8');
        const v = JSON.parse(raw).last_run_ms;
        return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
    }
    catch {
        return 0;
    }
}
// 写本次真送达自检时间戳（ms）。失败吞掉（落盘失败不阻断自检）。
function writeDeliveryLastRun(nowMs, stampPath = deliverySelfcheckStampPath()) {
    try {
        node_fs_1.default.writeFileSync(stampPath, JSON.stringify({ last_run_ms: nowMs }), 'utf-8');
    }
    catch {
        // ignore — 落盘失败只是少一次节流记忆，不影响自检本身
    }
}
// ---------- 带发送接缝自检：--verify-silent --target 文件传输助手（真发一条到自己）----------
// 只读自检（--no-send）不覆盖真送达 + 切会话后焦点归还，必须带发送才触发那两条。给「文件传输助手」
// 发（自己的会话，不打扰真人），读回确认原文真出现（真送达）+ 操作后焦点还回（不抢焦点）。
// 解析 --verify-silent --target（带发送）的输出 → 真送达+焦点归还结论（纯函数，CI 可测）。
//   sent:true && restored:true → ok（DELIVERED + 焦点归还）
//   sent:false                 → 红（NOT DELIVERED，真送达失败）
//   sent:true && restored:false→ 红（NOT RESTORED，送达了但焦点没还回）
//   error 含环境未就绪关键词    → skip（微信未登录/找不到会话/非Windows/pywinauto 缺）
//   解析不出                    → skip
function interpretVerifyDelivery(exitCode, stdout) {
    const parsed = parseLastJsonLine(stdout);
    if (parsed && typeof parsed.error === 'string') {
        const err = parsed.error;
        if (/NO_WINDOW|未登录|必须在 Windows|pywinauto|找不到.*微信|找不到目标会话/.test(err)) {
            return { ok: true, skipped: true, found: err };
        }
        return { ok: false, fixGuide: `带发送自检异常：${err}` };
    }
    if (parsed && parsed.sent === false) {
        return {
            ok: false,
            found: 'NOT_DELIVERED',
            fixGuide: '微信客服真送达失败（NOT DELIVERED）— 发出后读回会话预览未确认原文，' +
                '检查 _uia_send / 会话切换 / _read_session_preview。',
        };
    }
    if (parsed && parsed.sent === true && parsed.restored === false) {
        return {
            ok: false,
            found: 'NOT_RESTORED',
            fixGuide: '消息已送达但前台焦点未还回（NOT RESTORED）— 检查 _set_foreground_window 的三方 AttachThreadInput。',
        };
    }
    if (parsed && parsed.sent === true && parsed.restored === true) {
        return { ok: true, found: 'DELIVERED' };
    }
    void exitCode;
    return { ok: true, skipped: true };
}
// 跑带发送自检：spawn listen_chat.py --verify-silent --target 文件传输助手（真发到自己，验真送达+焦点归还）。
// MOCK_VERIFY_DELIVERY env（delivered/not_delivered/skip）可在任何平台注入；非 Windows 无 MOCK 时 skip。
function checkVerifyDelivery(moduleDir) {
    const mock = process.env.MOCK_VERIFY_DELIVERY;
    if (mock === 'delivered')
        return { ok: true, found: 'DELIVERED' };
    if (mock === 'not_delivered') {
        return { ok: false, found: 'NOT_DELIVERED', fixGuide: '微信客服真送达失败（NOT DELIVERED）。' };
    }
    if (mock === 'skip')
        return { ok: true, skipped: true };
    if (process.platform !== 'win32')
        return { ok: true, skipped: true };
    // 节流：这一条会主动发到「文件传输助手」远程确认在线，默认 1 小时一次（别每几秒/几分钟就发）。
    // 不到间隔 → skip（不发消息、不误红）；只读静默自检不受此节流影响仍每轮跑。
    // 先写后发：即使下面 spawn 异常/挂起，时间戳也已推进，避免 retry-storm 把节流绕过。
    // MOCK_DELIVERY_SELFCHECK_NOW（ms）供测试注入"当前时间"。
    const nowMs = Number(process.env.MOCK_DELIVERY_SELFCHECK_NOW) || Date.now();
    if (!shouldRunDeliverySelfcheck(nowMs, readDeliveryLastRun())) {
        return {
            ok: true,
            skipped: true,
            found: `真送达自检节流：距上次 < ${exports.DELIVERY_SELFCHECK_INTERVAL_SEC}s（1h），本轮不发文件传输助手`,
        };
    }
    writeDeliveryLastRun(nowMs);
    const dir = moduleDir ?? __dirname;
    const python = getModulePython(dir);
    const script = node_path_1.default.join(dir, 'wechat-rpa', 'listen_chat.py');
    if (!node_fs_1.default.existsSync(script)) {
        return { ok: true, skipped: true, found: 'listen_chat.py 缺失，跳过带发送自检' };
    }
    try {
        const r = (0, node_child_process_1.spawnSync)(python, [script, '--verify-silent', '--target', '文件传输助手', '--message', '[preflight-selfcheck] 真送达+焦点自检'], { encoding: 'utf-8', windowsHide: true, timeout: 45000 });
        const exitCode = typeof r.status === 'number' ? r.status : 1;
        const stdout = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
        return interpretVerifyDelivery(exitCode, stdout);
    }
    catch (e) {
        return { ok: true, skipped: true, found: `带发送自检无法运行：${e.message}` };
    }
}
// ---------- 自动修复：下载工具 ----------
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = node_fs_1.default.createWriteStream(dest);
        node_https_1.default
            .get(url, (res) => {
            res.pipe(file);
            res.on('end', () => file.close(() => resolve()));
            res.on('error', reject);
        })
            .on('error', reject);
    });
}
// ---------- 强版关更新（wechat_update_lock.py 接线）----------
// 解析 wechat_update_lock.py（run_update_lock）输出 → 是否真锁死（纯函数，CI 可测）。
//   locked:true            → ok（LOCKED）
//   locked:false           → 红（NOT_LOCKED，诚实，不假装锁死）
//   status:skipped（非 Win）→ skip 不误判红
//   解析不出（空/乱码/缺 python）→ skip 不误判红
function interpretUpdateLock(exitCode, stdout) {
    const parsed = parseLastJsonLine(stdout);
    if (parsed && parsed.status === 'skipped') {
        return { ok: true, skipped: true, found: typeof parsed.detail === 'string' ? parsed.detail : '非 Windows 跳过关更新' };
    }
    if (parsed && parsed.locked === true) {
        return { ok: true, found: 'LOCKED' };
    }
    if (parsed && parsed.locked === false) {
        const detail = typeof parsed.detail === 'string' ? parsed.detail : '';
        return {
            ok: false,
            found: 'NOT_LOCKED',
            fixGuide: `微信自动更新未锁死（重启可能自升回 4.1.10）：${detail}`,
        };
    }
    void exitCode;
    return { ok: true, skipped: true };
}
// 构造「提权跑关更新」的 PowerShell 参数（纯函数，CI 可测，遗留① / decision b9f4f602）。
// 关更新要改 Program Files 的 WeixinUpdate.exe / 写 hosts / 改注册表 —— 全需 admin。
// agent 本体保持普通用户（保 UIA 不受 UIPI 隔离），故仅这一步子进程用 Start-Process -Verb RunAs 提权。
// RunAs 起的提权进程 stdout 父进程收不到（且 -RedirectStandardOutput 与 -Verb RunAs 不兼容），
// 故让 python 把 JSON 结果写到 --output <file>，提权进程 -Wait 退出后父进程读回该文件再 interpret。
function buildElevatedLockArgs(python, script, outFile) {
    const psCmd = `Start-Process -FilePath '${python}' ` +
        `-ArgumentList '${script}','--output','${outFile}' ` +
        `-Verb RunAs -Wait`;
    return ['-NoProfile', '-NonInteractive', '-Command', psCmd];
}
// 跑强版关更新：提权 spawnSync powershell Start-Process RunAs → python wechat_update_lock.py
// （real run，run_update_lock 杀更新进程 + 改名 .disabled + icacls + hosts 屏蔽 + AutoUpdate=0，
// 并 interpret_lock_verify 诚实判定）。提权进程结果经 --output 文件回传，父进程读回 interpret。
// MOCK_UPDATE_LOCK env（locked/not_locked/skip）可在任何平台注入；非 Windows 无 MOCK 时 skip。
function lockWechatUpdate(moduleDir) {
    const mock = process.env.MOCK_UPDATE_LOCK;
    if (mock === 'locked')
        return { ok: true, found: 'LOCKED' };
    if (mock === 'not_locked') {
        return { ok: false, found: 'NOT_LOCKED', fixGuide: '微信自动更新未锁死（重启可能自升回 4.1.10）。' };
    }
    if (mock === 'skip')
        return { ok: true, skipped: true };
    if (process.platform !== 'win32')
        return { ok: true, skipped: true };
    const dir = moduleDir ?? __dirname;
    const python = getModulePython(dir);
    const script = node_path_1.default.join(dir, 'wechat-rpa', 'wechat_update_lock.py');
    if (!node_fs_1.default.existsSync(script)) {
        return { ok: true, skipped: true, found: 'wechat_update_lock.py 缺失，跳过关更新' };
    }
    // 提权进程把结果写到 outFile（RunAs stdout 父进程收不到）；父进程 -Wait 后读回。
    const outFile = node_path_1.default.join(node_os_1.default.tmpdir(), `zj-update-lock-${process.pid}-${Date.now()}.json`);
    try {
        if (node_fs_1.default.existsSync(outFile))
            node_fs_1.default.unlinkSync(outFile);
    }
    catch {
        /* best-effort 清理旧文件 */
    }
    try {
        // Start-Process -Verb RunAs 触发 UAC 弹窗提权（agent 本体不提权，保 UIA）。
        (0, node_child_process_1.spawnSync)('powershell', buildElevatedLockArgs(python, script, outFile), {
            encoding: 'utf-8',
            windowsHide: true,
            timeout: 120000,
        });
        if (!node_fs_1.default.existsSync(outFile)) {
            // 提权进程没产出结果文件（多为 UAC 被取消 / 提权失败）→ 不假装锁死，跳过不误判红。
            return { ok: true, skipped: true, found: '关更新提权进程未产出结果（UAC 取消？），跳过' };
        }
        const stdout = node_fs_1.default.readFileSync(outFile, 'utf-8');
        return interpretUpdateLock(0, stdout);
    }
    catch (e) {
        return { ok: true, skipped: true, found: `关更新无法运行：${e.message}` };
    }
    finally {
        try {
            if (node_fs_1.default.existsSync(outFile))
                node_fs_1.default.unlinkSync(outFile);
        }
        catch {
            /* best-effort 清理结果文件 */
        }
    }
}
// ---------- 自动修复：安装微信 ----------
// 装完 4.1.8 后返回「强版关更新」的诚实结论（CheckOutcome）。调用方（autoRepair → runPreflight）
// 据此决定 preflight 红绿：没真锁死不假装锁死。moduleDir 用于定位 wechat-rpa/wechat_update_lock.py。
async function installWeChat(downloadDir, moduleDir) {
    const installer = node_path_1.default.join(downloadDir, 'WeChatWin_4.1.8.exe');
    await downloadFile(exports.WECHAT_DOWNLOAD_URL, installer);
    // 终止所有微信相关进程（3.x: WeChat/WeChatAppEx；4.x: Weixin/WeixinUpdate）
    for (const im of ['WeChat.exe', 'WeChatAppEx.exe', 'Weixin.exe', 'WeixinUpdate.exe']) {
        (0, node_child_process_1.spawnSync)('taskkill', ['/F', '/IM', im], { windowsHide: true, stdio: 'ignore' });
    }
    // 卸载已有版本，防止 3.x（WeChat\）和 4.x（Weixin\）并存导致启动用错版本
    const uninstallers = [
        'C:\\Program Files\\Tencent\\WeChat\\Uninstall.exe', // 3.x 64-bit
        'C:\\Program Files (x86)\\Tencent\\WeChat\\Uninstall.exe', // 3.x 32-bit
        'C:\\Program Files\\Tencent\\Weixin\\Uninstall.exe', // 4.x
    ];
    for (const uninst of uninstallers) {
        if (node_fs_1.default.existsSync(uninst)) {
            // 卸载程序也需要 admin 权限，用 PowerShell RunAs 提权
            (0, node_child_process_1.spawnSync)('powershell', ['-NoProfile', '-NonInteractive', '-Command',
                `Start-Process -FilePath '${uninst}' -ArgumentList '/S' -Verb RunAs -Wait`], { windowsHide: true, timeout: 90000 });
        }
    }
    // 用 PowerShell Start-Process -Verb RunAs 触发 UAC 弹窗安装，agent 本身保持普通用户（UIA 不受影响）。
    // 直接 spawnSync(installer, ['/S']) 在普通用户下报 WinError 740（需提权），且叫用户
    // "以管理员身份运行 start.bat" 会破坏 UIA（UIPI 隔离导致 Access denied）。
    (0, node_child_process_1.spawnSync)('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        `Start-Process -FilePath '${installer}' -ArgumentList '/S' -Verb RunAs -Wait`], { windowsHide: true, timeout: 300000 });
    // 刀2（2026-06-29 反转 6-24「锁不住所以不锁」）：装完 4.1.8 后立刻调强版关更新锁住。
    // 顺序必须「先装 4.1.8 → 再锁」（wechat_update_lock.py 假设当前已是目标版本，只关更新不重装）。
    // 关更新做：杀更新进程 + WeixinUpdate.exe 改名 .disabled + icacls + hosts 屏蔽腾讯更新域名 +
    // AutoUpdate=0（install-dir 与 AppData xwechat 两处更新器全锁）。listen_chat 每 5 分钟重施维持。
    // 经 _repairFuncs 调用以便测试替换；返回 interpret_lock_verify 的诚实结论（没锁死不假装锁死）。
    return exports._repairFuncs.lockWechatUpdate(moduleDir);
}
// ---------- 自动修复：安装 pywinauto ----------
exports.GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';
exports.PIP_INDEX_URL = 'https://pypi.tuna.tsinghua.edu.cn/simple/';
async function installPywinauto(pythonPath, downloadDir) {
    const getPipScript = node_path_1.default.join(downloadDir, 'get-pip.py');
    await downloadFile(exports.GET_PIP_URL, getPipScript);
    (0, node_child_process_1.spawnSync)(pythonPath, [getPipScript, '--quiet'], { windowsHide: true, timeout: 60000 });
    (0, node_child_process_1.spawnSync)(pythonPath, ['-m', 'pip', 'install', 'pywinauto', '--quiet', '--index-url', exports.PIP_INDEX_URL], { windowsHide: true, timeout: 120000 });
}
// _repairFuncs 允许测试替换（CJS 直接调用同文件函数无法被 vi.spyOn 拦截）
exports._repairFuncs = {
    installWeChat,
    installPywinauto,
    lockWechatUpdate,
};
// 返回降级链路里产生的「关更新」诚实结论（仅 wechatFailed 时才会装 4.1.8 + 锁更新）。
async function autoRepair(targets, pythonPath, downloadDir, moduleDir) {
    let updateLock;
    const tasks = [];
    if (targets.wechatFailed) {
        tasks.push(exports._repairFuncs.installWeChat(downloadDir, moduleDir).then((r) => {
            updateLock = r;
        }));
    }
    if (targets.pywinautoFailed)
        tasks.push(exports._repairFuncs.installPywinauto(pythonPath, downloadDir));
    await Promise.all(tasks);
    return { updateLock };
}
// 解析模块自带的 python-embedded/python.exe，否则回退系统 python（Windows 无 python3）。
// 回退顺序：1) 模块自带 python-embedded  2) ZENITHJOY_CORE_DIR/python-embedded  3) 系统 python
function getModulePython(moduleDir) {
    const embedded = node_path_1.default.join(moduleDir, 'python-embedded', 'python.exe');
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
// 模块入口：core 在 fork 前调用，三项全过才激活。
// moduleDir 可选，不传时取本文件所在目录（CLI 直接跑时由 main guard 传入）。
// 两阶段：首轮检测 → Windows 且检测失败则 autoRepair → 修复后重检 → 软检测。
async function runPreflight(moduleDir) {
    const dir = moduleDir ?? __dirname;
    const python = getModulePython(dir);
    const downloadDir = node_path_1.default.join(node_os_1.default.tmpdir(), 'zenithjoy-setup');
    node_fs_1.default.mkdirSync(downloadDir, { recursive: true });
    // 首轮检测
    let wechat = checkWechatVersion();
    let pyw = await checkPywinauto(python);
    const mem = checkMemory();
    // 降级链路里产生的「强版关更新」诚实结论（仅 wechatFailed → 装 4.1.8 → 锁更新时才有）。
    let updateLock;
    // 自动修复（仅 Windows，非 CI mock 模式）
    if (process.platform === 'win32' && !process.env.MOCK_WECHAT_VERSION) {
        const needRepair = !wechat.ok || !pyw.ok;
        if (needRepair) {
            const repair = await autoRepair({ wechatFailed: !wechat.ok, pywinautoFailed: !pyw.ok }, python, downloadDir, dir);
            updateLock = repair.updateLock;
            // 修复后重检
            wechat = checkWechatVersion();
            pyw = await checkPywinauto(python);
        }
    }
    // 独立关更新自检（bug① 修复）：不管微信是否刚装，每次开机自检都跑一次关更新 + 校验。
    // 降级路径（installWeChat）已设 updateLock 时直接复用（不重复触发 UAC 弹窗）。
    // MOCK_UPDATE_LOCK / 非 Windows → _repairFuncs.lockWechatUpdate 内部处理（skipped/mock）。
    // 使用 _repairFuncs.lockWechatUpdate 而非直接调 lockWechatUpdate，使测试可 spy 计数验证。
    if (!updateLock) {
        updateLock = exports._repairFuncs.lockWechatUpdate(dir);
    }
    // 软检测：微信进程是否在跑（ok 始终 true）
    const running = checkWechatRunning();
    // 静默接缝自检（只读，不发消息）。微信没登录/没装时 skip，不误判红。
    const silent = checkVerifySilent(dir);
    // 带发送接缝自检（真发到「文件传输助手」，验真送达 + 焦点归还）。环境不就绪 skip 不误红。
    const delivery = checkVerifyDelivery(dir);
    // 关更新闸：present（降级机 / MOCK）才计入，未 present 视为通过（非降级机由 listen_chat 维持）。
    const updateLockOk = updateLock ? updateLock.ok : true;
    const checks = {
        wechat_version: wechat.ok,
        pywinauto: pyw.ok,
        memory: mem.ok,
        verify_silent: silent.ok,
        verify_delivery: delivery.ok,
        ...(updateLock ? { update_lock: updateLock.ok } : {}),
    };
    // 透出到 module_status.reason（车队看板可见）：微信版本号 + 静默 + 真送达 + 关更新状态。
    const summaryParts = [];
    if (wechat.found)
        summaryParts.push(`微信 ${wechat.found}`);
    else if (wechat.skipped)
        summaryParts.push('微信版本未检(非Windows)');
    if (silent.found === 'SILENT')
        summaryParts.push('静默 SILENT');
    else if (silent.found === 'NOT_SILENT')
        summaryParts.push('静默 NOT-SILENT');
    else if (silent.skipped)
        summaryParts.push('静默 跳过');
    if (delivery.found === 'DELIVERED')
        summaryParts.push('送达 DELIVERED');
    else if (delivery.found === 'NOT_DELIVERED')
        summaryParts.push('送达 NOT-DELIVERED');
    else if (delivery.found === 'NOT_RESTORED')
        summaryParts.push('焦点 NOT-RESTORED');
    else if (delivery.skipped)
        summaryParts.push('送达 跳过');
    if (updateLock?.found === 'LOCKED')
        summaryParts.push('更新 LOCKED');
    else if (updateLock?.found === 'NOT_LOCKED')
        summaryParts.push('更新 NOT-LOCKED');
    else if (updateLock?.skipped)
        summaryParts.push('更新 跳过');
    const summary = summaryParts.join(' / ');
    if (wechat.ok && pyw.ok && mem.ok && silent.ok && delivery.ok && updateLockOk) {
        const okReason = buildOkReason(summary, running.fixGuide);
        return {
            ok: true,
            checks,
            ...(okReason ? { reason: okReason } : {}),
            ...(running.fixGuide ? { fixGuide: running.fixGuide } : {}),
        };
    }
    const fixGuide = [wechat, pyw, mem, silent, delivery, ...(updateLock ? [updateLock] : [])]
        .filter((c) => !c.ok && c.fixGuide)
        .map((c) => c.fixGuide)
        .join('\n');
    const reason = summary ? `${summary}\n${fixGuide}` : fixGuide;
    return { ok: false, checks, fixGuide, reason };
}
// ok=true 的 module_status.reason 拼接（纯函数，issue 5d9f996c）：只保留状态型摘要（版本/静默/
// 送达/更新），绝不拼入 failed/warn 级行动指令文案（如「微信未运行，请打开微信并登录」）——
// 生产实锤（0706 09:58）ok:true 的 reason 带「微信未运行请打开」自相矛盾误导运营。
// 行动指令走独立的 fixGuide 字段，不进 ok=true 的 reason。
function buildOkReason(summary, _runningFixGuide) {
    return summary || undefined;
}
// 作为脚本直接执行时（core ModuleManager 用 `node preflight.js`，cwd=moduleDir，不传 argv）：
// 把结果以 JSON 打印为 stdout 最后一行，退出码与 ok 对应。moduleDir 默认取本文件所在目录。
if (require.main === module) {
    const moduleDir = process.argv[2] || __dirname;
    runPreflight(moduleDir)
        .then((result) => {
        console.log(JSON.stringify(result));
        process.exit(result.ok ? 0 : 1);
    })
        .catch((e) => {
        console.log(JSON.stringify({ ok: false, checks: {}, fixGuide: e.message }));
        process.exit(1);
    });
}
