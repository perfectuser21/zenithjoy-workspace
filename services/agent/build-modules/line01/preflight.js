"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPreflight = runPreflight;
// line01-publish stub preflight
// 空壳模块：无真实环境依赖，恒通过。
// 加厚时替换为真实检测 + fixGuide（参考 line04/preflight.ts）。
async function runPreflight(_moduleDir) {
    return { ok: true, checks: {} };
}
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
