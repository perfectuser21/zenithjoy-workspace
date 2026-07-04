package com.zenithjoy.agent

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** 开机自启：收到 BOOT_COMPLETED 时拉起 AgentService。 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            val config = AgentConfig(context)
            if (config.isConfigured) {
                context.startForegroundService(Intent(context, AgentService::class.java))
            }
        }
    }
}
