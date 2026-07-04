package com.zenithjoy.agent

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

/**
 * 配置入口 Activity：首次启动输入 licenseKey，之后显示当前 Agent 状态。
 * 生产形态可替换成更完整的 UI；骨架阶段保持最简。
 */
class MainActivity : AppCompatActivity() {

    private lateinit var config: AgentConfig

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        config = AgentConfig(this)

        if (config.isConfigured) {
            showStatus()
        } else {
            showLicenseInput()
        }
    }

    private fun showLicenseInput() {
        val layout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(48, 48, 48, 48)
        }
        val input = EditText(this).apply { hint = "License Key (ZJ-XXXX)" }
        val apiInput = EditText(this).apply {
            hint = "API URL (留空用默认)"
            setText(AgentConfig.DEFAULT_WS_URL)
        }
        val saveBtn = Button(this).apply { text = "启动 Agent" }
        saveBtn.setOnClickListener {
            val license = input.text.toString().trim()
            if (license.isEmpty()) {
                Toast.makeText(this, "请输入 License Key", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            config.licenseKey = license
            val apiUrl = apiInput.text.toString().trim()
            if (apiUrl.isNotEmpty()) config.apiUrl = apiUrl

            startAgentService()
            showStatus()
        }
        layout.addView(input)
        layout.addView(apiInput)
        layout.addView(saveBtn)
        setContentView(layout)
    }

    private fun showStatus() {
        val layout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(48, 48, 48, 48)
        }
        val status = TextView(this).apply {
            text = buildString {
                appendLine("ZenithJoy Agent")
                appendLine()
                appendLine("Agent ID: ${config.agentId.ifEmpty { "未注册" }}")
                appendLine("Machine ID: ${config.machineId.ifEmpty { "未计算" }}")
                appendLine("注册状态: ${if (config.isRegistered) "已注册 (tier=${config.tier})" else "未注册"}")
                appendLine("API: ${config.apiUrl}")
            }
        }
        val startBtn = Button(this).apply { text = "重启 Agent 服务" }
        startBtn.setOnClickListener { startAgentService() }
        val resetBtn = Button(this).apply { text = "重置 License" }
        resetBtn.setOnClickListener {
            config.licenseKey = ""
            config.wsToken = ""
            showLicenseInput()
        }
        layout.addView(status)
        layout.addView(startBtn)
        layout.addView(resetBtn)
        setContentView(layout)

        if (config.isConfigured) startAgentService()
    }

    private fun startAgentService() {
        val intent = Intent(this, AgentService::class.java)
        startForegroundService(intent)
    }
}
