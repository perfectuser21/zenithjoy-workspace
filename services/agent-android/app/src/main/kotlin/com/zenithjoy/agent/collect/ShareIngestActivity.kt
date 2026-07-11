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
        handled = false
        pollCount = 0
        route(intent)
    }

    private fun route(intent: Intent?) {
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
        // 3s 自杀超时兜底（焦点始终不来时不泄漏）
        handler.postDelayed({ if (!handled) finishRead(null) }, SELF_KILL_MS)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus || handled) return
        when (mode) {
            MODE_CLEAR_CLIPBOARD -> {
                clearClipboard()
                handled = true
                DouyinCollectService.deliverClearDone(token)
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

    private fun clearClipboard() {
        try {
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(android.content.ClipData.newPlainText("", ""))
        } catch (e: Exception) {
            android.util.Log.w(TAG, "clearClipboard failed: ${e.message}")
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
