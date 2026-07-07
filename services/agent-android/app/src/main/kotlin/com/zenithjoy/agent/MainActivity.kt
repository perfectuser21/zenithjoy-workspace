package com.zenithjoy.agent

import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.zenithjoy.agent.onboarding.collectServiceEnabled
import com.zenithjoy.agent.onboarding.parseBindDeepLink

/**
 * 配置入口 Activity：首次启动输入 licenseKey，之后显示当前 Agent 状态。
 * 生产形态可替换成更完整的 UI；骨架阶段保持最简。
 */
class MainActivity : AppCompatActivity() {

    private lateinit var config: AgentConfig

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        config = AgentConfig(this)

        val bind = parseBindDeepLink(intent?.data?.toString())
        if (!bind.license.isNullOrEmpty()) {
            config.licenseKey = bind.license!!
            if (!bind.api.isNullOrEmpty()) config.apiUrl = bind.api!!
            startAgentService()
            showStatus()
            return
        }

        if (config.isConfigured) {
            showStatus()
        } else {
            showLicenseInput()
        }
    }

    override fun onResume() {
        super.onResume()
        if (config.isConfigured) showStatus() else showLicenseInput()
    }

    private fun accessibilityBanner(): android.view.View {
        val enabled = collectServiceEnabled(this)
        return if (enabled) {
            TextView(this).apply { text = "无障碍 ✅ 已开启" }
        } else {
            val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            box.addView(TextView(this).apply { text = "⚠️ 无障碍未开启，采集无法运行" })
            box.addView(Button(this).apply {
                text = "开启无障碍权限"
                setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
            })
            box
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
        layout.addView(accessibilityBanner())
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
                appendLine("无障碍: ${if (collectServiceEnabled(this@MainActivity)) "已开启" else "未开启"}")
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
        layout.addView(accessibilityBanner())
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
