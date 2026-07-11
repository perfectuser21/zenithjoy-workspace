package com.zenithjoy.agent.collect

import android.app.Activity
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper

/**
 * Bug C：取链接收器，两条路径共用。
 * - ACTION_SEND（旧兼容）：onCreate 即收即 finish，token 用 LEGACY 豁免。
 * - read_clipboard：抖音"分享链接"把口令文案写进剪贴板。Android 10+ 只有前台焦点窗口能读，
 *   故本 Activity 拉到前台，在 onWindowFocusChanged(true) 后读，读不到 100ms 轮询 ≤10 次，
 *   3s 自杀超时（严格短于服务侧等待预算）。
 * - clear_clipboard：获焦后清空剪贴板做基线，回投 CLEAR_DONE。
 */
class ShareIngestActivity : Activity() {

    private var mode: String = MODE_READ_CLIPBOARD
    private var token: Long = DouyinCollectService.LEGACY_ACTION_SEND_TOKEN
    private var handled = false
    private var pollCount = 0
    private val handler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        route(intent)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        route(intent)
    }

    private fun route(intent: Intent?) {
        // singleTask 复用（onNewIntent）时上一轮的自杀定时器/poll 回调还挂在队列里，
        // handled 复位后会复活并按旧时限提前 finishRead(null) 截短新一轮预算——
        // 进任何分支前先清空 handler 队列，再重置本轮状态。
        handler.removeCallbacksAndMessages(null)
        handled = false
        pollCount = 0
        if (intent?.action == Intent.ACTION_SEND) {
            val text = intent.getStringExtra(Intent.EXTRA_TEXT)
            android.util.Log.i(TAG, "ACTION_SEND len=${text?.length ?: 0}")
            DouyinCollectService.deliverShareText(text, DouyinCollectService.LEGACY_ACTION_SEND_TOKEN)
            finish()
            return
        }
        mode = intent?.getStringExtra(EXTRA_INGEST_MODE) ?: MODE_READ_CLIPBOARD
        token = intent?.getLongExtra(EXTRA_INGEST_TOKEN, DouyinCollectService.LEGACY_ACTION_SEND_TOKEN)
            ?: DouyinCollectService.LEGACY_ACTION_SEND_TOKEN
        DouyinCollectService.noteIngestLaunched(token)
        // 3s 自杀超时兜底（焦点始终不来时不泄漏）。按 mode 分流：
        // clear 模式超时绝不走读通道回投（服务侧由 CLEAR_WAIT_MS 超时判败收尾），
        // 只有 read 模式才 finishRead(null)。
        handler.postDelayed({ if (!handled) onSelfKillTimeout() }, SELF_KILL_MS)
    }

    private fun onSelfKillTimeout() {
        when (mode) {
            MODE_CLEAR_CLIPBOARD -> {
                // 不回投任何结果：基线未清成功，服务侧 CLEAR_WAIT 超时会判败跳过该卡。
                android.util.Log.w(TAG, "clear mode self-kill timeout, no deliver token=$token")
                handled = true
                handler.removeCallbacksAndMessages(null)
                finish()
            }
            else -> finishRead(null)
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus || handled) return
        when (mode) {
            MODE_CLEAR_CLIPBOARD -> {
                // 只有清空真正成功才回投 CLEAR_DONE；失败（如荣耀策略静默拒绝
                // setPrimaryClip 抛异常）不回投，让服务侧 CLEAR_WAIT_MS 超时判败、
                // 该卡跳过——绝不让残留旧短链被误当新链上报（防串号造假）。
                val cleared = clearClipboard()
                handled = true
                if (cleared) {
                    DouyinCollectService.deliverClearDone(token)
                } else {
                    android.util.Log.w(TAG, "clearClipboard failed, NOT delivering CLEAR_DONE token=$token")
                }
                finish()
            }
            else -> tryReadClipboard()
        }
    }

    private fun tryReadClipboard() {
        val text = readClipboardText()
        if (text != null) {
            finishRead(text)
            return
        }
        if (pollCount++ < MAX_POLL) {
            handler.postDelayed({ if (!handled) tryReadClipboard() }, POLL_INTERVAL_MS)
        }
        // 达上限后交给 SELF_KILL_MS 兜底 finishRead(null)
    }

    private fun finishRead(text: String?) {
        if (handled) return
        handled = true
        handler.removeCallbacksAndMessages(null)
        DouyinCollectService.deliverShareText(text, token)
        finish()
    }

    private fun readClipboardText(): String? {
        return try {
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = cm.primaryClip ?: return null
            if (clip.itemCount == 0) return null
            clip.getItemAt(0).coerceToText(this)?.toString()?.takeIf { it.isNotEmpty() }
        } catch (e: Exception) {
            android.util.Log.w(TAG, "readClipboard failed: ${e.message}")
            null
        }
    }

    /** 清空剪贴板基线。返回是否成功——失败时调用方不得回投 CLEAR_DONE。 */
    private fun clearClipboard(): Boolean {
        return try {
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(android.content.ClipData.newPlainText("", ""))
            true
        } catch (e: Exception) {
            android.util.Log.w(TAG, "clearClipboard failed: ${e.message}")
            false
        }
    }

    companion object {
        private const val TAG = "ShareIngestActivity"
        private const val SELF_KILL_MS = 3_000L
        private const val POLL_INTERVAL_MS = 100L
        private const val MAX_POLL = 10
        const val EXTRA_INGEST_MODE = "ingest_mode"
        const val EXTRA_INGEST_TOKEN = "ingest_token"
        const val MODE_READ_CLIPBOARD = "read_clipboard"
        const val MODE_CLEAR_CLIPBOARD = "clear_clipboard"

        fun launchReadIntent(ctx: Context, token: Long): Intent =
            Intent(ctx, ShareIngestActivity::class.java).apply {
                putExtra(EXTRA_INGEST_MODE, MODE_READ_CLIPBOARD)
                putExtra(EXTRA_INGEST_TOKEN, token)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

        fun launchClearIntent(ctx: Context, token: Long): Intent =
            Intent(ctx, ShareIngestActivity::class.java).apply {
                putExtra(EXTRA_INGEST_MODE, MODE_CLEAR_CLIPBOARD)
                putExtra(EXTRA_INGEST_TOKEN, token)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
    }
}
