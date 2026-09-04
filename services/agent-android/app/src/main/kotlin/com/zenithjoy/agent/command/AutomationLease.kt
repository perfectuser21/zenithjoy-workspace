package com.zenithjoy.agent.command

import java.util.concurrent.atomic.AtomicReference

/**
 * 一机一自动化互斥（owner + 租约）。远程指令会话经 executor 每条指令续租；
 * 原生服务任务入口用 [isHeldByOther] 拒单。租约 120s 无续租自动过期——防
 * AI 循环在中台侧中止后设备端锁死原生流程（ScanMutex 永久 busy 事故前科，
 * 见 account/DeviceAccountScanService.kt:1265 注释）。
 * 注意：本锁不取代 ScanMutex（原生服务间互斥仍走 ScanMutex），只表达
 * 「远程指令会话正在驱动本机」这一事实。
 */
object AutomationLease {
    const val OWNER_REMOTE = "remote_cmd"
    const val OWNER_NATIVE = "native_task"
    const val LEASE_MS = 120_000L

    data class Holder(val owner: String, val expiresAt: Long)

    private val ref = AtomicReference<Holder?>(null)

    @Volatile
    var clock: () -> Long = { System.currentTimeMillis() }

    fun tryAcquire(owner: String): Boolean {
        while (true) {
            val now = clock()
            val cur = ref.get()
            if (cur != null && cur.owner != owner && cur.expiresAt > now) return false
            if (ref.compareAndSet(cur, Holder(owner, now + LEASE_MS))) return true
        }
    }

    fun release(owner: String) {
        val cur = ref.get() ?: return
        if (cur.owner == owner) ref.compareAndSet(cur, null)
    }

    fun currentOwner(): String? {
        val cur = ref.get() ?: return null
        return if (cur.expiresAt > clock()) cur.owner else null
    }

    fun isHeldByOther(me: String): Boolean = currentOwner()?.let { it != me } ?: false

    fun resetForTest() {
        ref.set(null)
        clock = { System.currentTimeMillis() }
    }
}
