package com.zenithjoy.agent.collect

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Bug C：share-intent 接收器。抖音视频详情页点「分享」后，分享面板里出现本 app；
 * 用户/无障碍点击本 app → 系统以 ACTION_SEND(text/plain) 拉起本 Activity，
 * intent.EXTRA_TEXT 即抖音生成的分享文案（含 v.douyin.com 短链）。
 *
 * 本 Activity 无 UI：取出文案交给 [DouyinCollectService.deliverShareText]（同进程静态入口，
 * 由服务实例抽短链并 complete 正在等待的卡片）后立即 finish，让前台退回抖音继续采下一张卡。
 */
class ShareIngestActivity : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleShareIntent(intent)
        finish()
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        handleShareIntent(intent)
        finish()
    }

    private fun handleShareIntent(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)
        android.util.Log.i("ShareIngestActivity", "received ACTION_SEND, len=${text?.length ?: 0}")
        DouyinCollectService.deliverShareText(text)
    }
}
