"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * line02-lead-gen 模块入口
 * 被 core 通过 child_process.fork() 拉起，收到 config 即回 ready。
 * 轮询 /api/acquisition/pending-collect-tasks，派发采集任务给 keyword-search-douyin.cjs。
 */
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const https = __importStar(require("https"));
const http = __importStar(require("http"));
let config = {};
let pollTimer = null;
function apiRequest(url, method = 'GET', body) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const lib = parsed.protocol === 'https:' ? https : http;
        const bodyStr = body ? JSON.stringify(body) : undefined;
        const req = lib.request({
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
            },
        }, (res) => {
            let data = '';
            res.on('data', (d) => (data += d));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                }
                catch {
                    resolve({ ok: true });
                }
            });
        });
        req.on('error', reject);
        if (bodyStr)
            req.write(bodyStr);
        req.end();
    });
}
async function pollAndDispatch() {
    const apiBase = config.apiBase || 'http://localhost:3000';
    try {
        const resp = (await apiRequest(`${apiBase}/api/acquisition/pending-collect-tasks`));
        const tasks = resp?.tasks ?? [];
        for (const task of tasks) {
            const keywords = Array.isArray(task.keywords) ? task.keywords : [];
            for (const kw of keywords.slice(0, 3)) {
                await spawnKeywordSearch(kw, task.id, apiBase);
            }
        }
    }
    catch (err) {
        process.stderr.write(`[line02] poll error: ${err.message}\n`);
    }
}
function spawnKeywordSearch(keyword, taskId, apiBase) {
    return new Promise((resolve) => {
        // ZENITHJOY_CORE_DIR is injected by module-manager (= dirname of agent exe).
        // Publishers live alongside the exe, not relative to the installed module __dirname.
        const coreDir = process.env.ZENITHJOY_CORE_DIR;
        const publishersDir = coreDir
            ? path.join(coreDir, 'publishers')
            : path.join(__dirname, '..', '..', 'publishers');
        const scriptPath = path.join(publishersDir, 'keyword-search-douyin.cjs');
        if (!fs.existsSync(scriptPath)) {
            process.stderr.write(`[line02] keyword-search script not found: ${scriptPath}\n`);
            return resolve();
        }
        // process.execPath is the agent exe (pkg-packed), which exits immediately due to
        // single-instance guard. Use the bundled node runtime extracted by start.bat instead.
        const nodeExe = process.env.ZENITHJOY_NODE_BIN ||
            path.join(process.env.APPDATA || process.env.HOME || '', 'ZenithJoy', 'runtime', 'nodejs', 'node.exe');
        const child = (0, child_process_1.spawn)(nodeExe, [scriptPath, keyword, '19222', '5'], {
            env: { ...process.env },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let lastLine = '';
        child.stdout?.on('data', (chunk) => {
            const lines = chunk.toString().split('\n').filter(Boolean);
            if (lines.length > 0)
                lastLine = lines[lines.length - 1];
        });
        child.stderr?.on('data', (chunk) => {
            process.stderr.write(`[line02/kw-search] ${chunk}`);
        });
        child.on('close', async () => {
            try {
                if (lastLine) {
                    const result = JSON.parse(lastLine);
                    if (result.ok && Array.isArray(result.video_urls) && result.video_urls.length > 0) {
                        // 上报视频 URL 给 collect/report（每条视频空评论占位，标记 stage_1_done 在 resolveTerminalStatus 处理）
                        for (const videoUrl of result.video_urls.slice(0, 5)) {
                            await apiRequest(`${apiBase}/api/acquisition/collect/report`, 'POST', {
                                task_id: taskId,
                                keyword,
                                video_id: videoUrl,
                                commenters: [],
                                terminal: result.video_urls.indexOf(videoUrl) === result.video_urls.length - 1 ? 'done' : undefined,
                            }).catch(() => { });
                        }
                    }
                    else if (result.ok && Array.isArray(result.video_urls) && result.video_urls.length === 0) {
                        // 0 个视频（验证码/无结果）：上报 failed，防任务永久卡 running
                        await apiRequest(`${apiBase}/api/acquisition/collect/report`, 'POST', {
                            task_id: taskId,
                            keyword,
                            video_id: `no-result-${Date.now()}`,
                            commenters: [],
                            terminal: 'failed',
                            error_code: 'NO_VIDEOS_FOUND',
                        }).catch(() => { });
                    }
                    else if (!result.ok) {
                        await apiRequest(`${apiBase}/api/acquisition/collect/report`, 'POST', {
                            task_id: taskId,
                            keyword,
                            video_id: `error-${Date.now()}`,
                            commenters: [],
                            terminal: 'failed',
                            error_code: result.error || 'KEYWORD_SEARCH_FAILED',
                        }).catch(() => { });
                    }
                }
            }
            catch {
                // 忽略 JSON 解析错误
            }
            resolve();
        });
    });
}
function schedulePoll() {
    const intervalMs = config.pollIntervalMs || 30000;
    pollTimer = setTimeout(async () => {
        await pollAndDispatch();
        schedulePoll();
    }, intervalMs);
}
process.on('message', (msg) => {
    if (msg?.type === 'config') {
        // agent 通过顶层字段发送 config（apiBase/agentId/machineId 在顶层，非嵌套 msg.config）
        config = msg.config ?? { apiBase: msg.apiBase };
        schedulePoll();
        process.send?.({ type: 'ready' });
    }
    if (msg?.type === 'stop') {
        if (pollTimer)
            clearTimeout(pollTimer);
        process.exit(0);
    }
});
