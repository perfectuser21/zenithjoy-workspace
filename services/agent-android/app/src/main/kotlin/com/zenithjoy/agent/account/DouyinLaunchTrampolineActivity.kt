package com.zenithjoy.agent.account

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper

/**
 * 透明 trampoline：让 App 先成为前台 Activity，再从前台拉起目标 App（默认抖音），随后立即 finish。
 *
 * 为什么需要它：荣耀 iAware 等厂商策略拒绝"没有前台 Activity 的调用方"拉起第三方 App
 * （4号机真机 0/5，`prevent start activity by iaware`），而调用方自己的 Activity 放行、
 * 从该 Activity 再拉目标则 `BAL_ALLOW_VISIBLE_WINDOW` 放行（3/3）。见 [DouyinLaunchTrampoline]。
 *
 * 形态对齐 ShareIngestActivity：Manifest 上 Translucent 主题 + noHistory + excludeFromRecents +
 * taskAffinity="" + singleTask；代码上有自杀定时器兜底（焦点始终不来也不泄漏），
 * singleTask 复用（onNewIntent）时先清旧定时器再重挂，避免带着上一轮的过期回调。
 */
class DouyinLaunchTrampolineActivity : Activity() {

    private val handler = Handler(Looper.getMainLooper())
    private var launched = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        armSelfKill()
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        launched = false
        armSelfKill()
    }

    override fun onResume() {
        super.onResume()
        if (launched) return
        launched = true
        launchTargetThenFinish()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    private fun armSelfKill() {
        handler.removeCallbacksAndMessages(null)
        handler.postDelayed({ if (!isFinishing) finish() }, SELF_KILL_MS)
    }

    private fun launchTargetThenFinish() {
        val target = DouyinLaunchTrampoline.resolveTargetPackage(
            intent?.getStringExtra(DouyinLaunchTrampoline.EXTRA_TARGET_PACKAGE),
        )
        try {
            val launch = packageManager.getLaunchIntentForPackage(target)
            if (launch == null) {
                android.util.Log.w(TAG, "目标未安装，无法拉起: $target")
            } else {
                launch.addFlags(DouyinLaunchTrampoline.TARGET_FLAGS)
                startActivity(launch)
                android.util.Log.i(TAG, "已从前台 trampoline 拉起 $target")
            }
        } catch (e: Exception) {
            android.util.Log.w(TAG, "trampoline 拉起 $target 失败: ${e.message}")
        }
        finish()
    }

    companion object {
        private const val TAG = "DouyinLaunchTrampoline"
        const val SELF_KILL_MS = 2_000L
    }
}
