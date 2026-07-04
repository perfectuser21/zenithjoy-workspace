package com.zenithjoy.agent

import android.app.Application

class AgentApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // 全局初始化（如日志框架）可在此扩展
    }
}
