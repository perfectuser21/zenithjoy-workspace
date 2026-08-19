package com.zenithjoy.agent

import android.app.Application

class AgentApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // 必须最先执行：okhttp 的 debug 刷屏会把 agent 自己的日志 1 分钟内冲出 logcat
        // 环形缓冲区，任何真机排查都建立在"日志还在"这个前提上（见 OkHttpDebugLogSilencer）。
        OkHttpDebugLogSilencer.silence()
    }
}
