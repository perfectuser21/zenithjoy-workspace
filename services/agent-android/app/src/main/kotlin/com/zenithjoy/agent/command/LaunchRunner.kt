package com.zenithjoy.agent.command

import kotlinx.coroutines.delay

/**
 * launch 指令。判定点（decision「launch 应用拉起成功判定」）：成功=前台包名轮询
 * 真到目标包，绝不以「startActivity 没抛异常」为准——ColorOS 静默拦截不抛异常
 * （DouyinCollectService.kt:224 真机实锤）、荣耀 iAware 拒后台拉起。
 * startLaunch 生产实现走 DouyinLaunchTrampoline（透明 trampoline，AgentService
 * videoOpener 同款姿势），异常时回退直启，任何路径抛异常返回 false。
 */
class LaunchRunner(
    private val whitelist: Set<String>,
    private val packageExists: (String) -> Boolean,
    private val startLaunch: (String) -> Boolean,
    private val foregroundPkg: () -> String?,
    private val sleep: suspend (Long) -> Unit = { delay(it) },
    private val pollIntervalMs: Long = 500L,
    private val timeoutMs: Long = 10_000L,
) {
    suspend fun run(pkg: String): CmdOutcome {
        if (pkg !in whitelist) return CmdOutcome(false, CommandProtocol.ERR_REFUSED_PACKAGE, mapOf("pkg" to pkg))
        if (!packageExists(pkg)) return CmdOutcome(false, CommandProtocol.ERR_PACKAGE_NOT_FOUND)
        if (!startLaunch(pkg)) return CmdOutcome(false, CommandProtocol.ERR_LAUNCH_FAILED)
        var waited = 0L
        while (waited < timeoutMs) {
            if (foregroundPkg() == pkg) return CmdOutcome(true)
            sleep(pollIntervalMs)
            waited += pollIntervalMs
        }
        return CmdOutcome(false, CommandProtocol.ERR_LAUNCH_NOT_FOREGROUND, mapOf("foreground" to (foregroundPkg() ?: "unknown")))
    }
}
