package com.zenithjoy.agent

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.zenithjoy.agent.onboarding.checkSelfAccessibility
import com.zenithjoy.agent.onboarding.VariantVerdict
import com.zenithjoy.agent.onboarding.checkVariantConflict
import com.zenithjoy.agent.onboarding.parseBindDeepLink

/**
 * 配置入口 Activity：首次启动输入 licenseKey，之后显示当前 Agent 状态。
 * 生产形态可替换成更完整的 UI；骨架阶段保持最简。
 *
 * MediaProjection 一次性系统截屏授权（sprints/07122051-content-judgment-client-wiring
 * 接续刀 Golden Path 第 1 步）：显式"启动 Agent"操作时，如果 MediaProjectionHolder 还没
 * 缓存过授权结果，就先弹一次系统截屏授权框；用户同意后把 resultCode/data 缓存进
 * MediaProjectionHolder，再启动 AgentService（AgentService 会用它换出真实
 * MediaProjection 实例）。用户拒绝也不阻塞 Agent 启动——采集主链路仍可运行，
 * 只是内容判定门槛这一刀会持续 pending，状态页面明确提示"截图未授权"方便真机巡检。
 *
 * 授权框只在显式操作（启动/重启按钮、授权截屏按钮、bind 深链首次配置）时弹出，
 * onResume 触发的被动"确保服务在跑"不会重复弹框骚扰用户。
 */
class MainActivity : AppCompatActivity() {

    private lateinit var config: AgentConfig

    private val mediaProjectionLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val data = result.data
        if (result.resultCode == Activity.RESULT_OK && data != null) {
            MediaProjectionHolder.cacheAuthorization(result.resultCode, data)
            android.util.Log.i(TAG, "MediaProjection authorized")
        } else {
            android.util.Log.w(TAG, "MediaProjection authorization denied/cancelled — content judgment stays pending")
            Toast.makeText(this, "截屏授权被拒绝，内容判定功能将持续 pending", Toast.LENGTH_LONG).show()
        }
        startAgentServiceReal()
        showStatus()
    }

    private val recordAudioPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            android.util.Log.i(TAG, "RECORD_AUDIO authorized")
        } else {
            android.util.Log.w(TAG, "RECORD_AUDIO denied — audio-based content judgment stays pending")
            Toast.makeText(this, "录音授权被拒绝，音频转写判定功能将持续 pending", Toast.LENGTH_LONG).show()
        }
        showStatus()
    }

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

    /**
     * 无障碍横幅。**必须全查三个服务**——旧实现只查采集那一个，客户开了采集没开私信时
     * 横幅显示绿、私信与账号扫描却静默全死（0820 BYOD 场景盘查发现）。
     * describe() 还会在服务被别的包拿走时直接点名劫持方。
     */
    private fun accessibilityBanner(): android.view.View {
        val check = checkSelfAccessibility(this)
        return if (check.allBound) {
            TextView(this).apply { text = "无障碍 ✅ 三个服务均已开启" }
        } else {
            val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            box.addView(TextView(this).apply { text = "⚠️ " + check.describe() })
            box.addView(Button(this).apply {
                text = "开启无障碍权限"
                setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
            })
            box
        }
    }

    /**
     * 同族变体包冲突横幅（VariantConflictGuard）。
     *
     * BLOCK 时把处置入口顶到最上面，但**绝不停掉 AgentService**——设备不心跳等于中台
     * 彻底看不见它，比「能看见但未就绪」更糟。客户机上我们唯一的远程视野就是心跳。
     */
    private fun variantConflictBanner(): android.view.View? {
        val conflict = checkVariantConflict(this)
        if (conflict.verdict == VariantVerdict.OK) return null

        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val prefix = if (conflict.verdict.blocksUsage()) "🛑 采集无法运行：" else "⚠️ "
        box.addView(TextView(this).apply { text = prefix + conflict.describe() })
        conflict.siblingPackages.forEach { sibling ->
            box.addView(Button(this).apply {
                text = "卸载 $sibling"
                setOnClickListener {
                    // 拉起系统卸载确认框，客户点一下"确定"即可，不用自己去应用列表里翻。
                    startActivity(Intent(Intent.ACTION_DELETE, Uri.parse("package:$sibling")))
                }
            })
        }
        return box
    }

    /** 状态自检：MediaProjection 截屏授权是否就绪，方便真机巡检定位"内容判定恒 pending"问题。 */
    private fun mediaProjectionBanner(): android.view.View {
        return if (MediaProjectionHolder.hasAuthorization()) {
            TextView(this).apply { text = "截图授权 ✅ 已授权（内容判定可用）" }
        } else {
            val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            box.addView(TextView(this).apply { text = "⚠️ 截图未授权，内容判定门槛将持续 pending" })
            box.addView(Button(this).apply {
                text = "授权截屏"
                setOnClickListener { requestMediaProjectionThenStart() }
            })
            box
        }
    }

    /** 状态自检：RECORD_AUDIO 权限是否就绪，方便真机巡检定位"音频判定恒 pending"问题。 */
    private fun recordAudioBanner(): android.view.View {
        val granted = ContextCompat.checkSelfPermission(
            this, Manifest.permission.RECORD_AUDIO,
        ) == PackageManager.PERMISSION_GRANTED
        return if (granted) {
            TextView(this).apply { text = "录音授权 ✅ 已授权（音频判定可用）" }
        } else {
            val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            box.addView(TextView(this).apply { text = "⚠️ 录音未授权，视频类内容判定将持续 pending" })
            box.addView(Button(this).apply {
                text = "授权录音"
                setOnClickListener { recordAudioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO) }
            })
            box
        }
    }

    /**
     * 状态自检：后台弹窗/自启动权限（sprint 08031620-android-scan-preconditions）。
     * 尽力而为信号（Settings.canDrawOverlays 不能覆盖所有厂商的后台启动限制真实状态，
     * 见 com.zenithjoy.agent.account.BackgroundPermissionCheck 说明），未授权时提示手动排查，
     * 不跳转具体设置页——各厂商（ColorOS/MIUI/EMUI）路径不统一，本 sprint 不做自动引导。
     */
    private fun backgroundPermissionBanner(): android.view.View {
        val canDrawOverlays = Settings.canDrawOverlays(this)
        val desc = com.zenithjoy.agent.account.BackgroundPermissionCheck.describeOverlayPermission(canDrawOverlays)
        return TextView(this).apply { text = desc }
    }

    /**
     * 「上墙」开关：把本机屏幕帧推给中台工作机控制塔，运营在 /dashboard/workers 里
     * 能看到这台机器在动。
     *
     * 默认关，且必须先有 MediaProjection 授权才推得动 —— 推屏幕是持续把客户机画面外传，
     * 只能由用户在这里显式打开。打开时若还没授权，就地弹一次系统截屏授权框，
     * 不让用户开完开关回头发现一直是黑的。
     */
    private fun wallPushBanner(): android.view.View {
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val on = config.wallPushEnabled
        box.addView(TextView(this).apply {
            text = if (!on) {
                "上墙（实时画面）：已关闭"
            } else if (MediaProjectionHolder.hasAuthorization()) {
                "上墙（实时画面）：已开启 ✅ 中控台可看到本机画面"
            } else {
                "⚠️ 上墙已开启，但截屏未授权 —— 画面推不上去，请点下面按钮重新授权"
            }
        })
        box.addView(Button(this).apply {
            text = if (on) "关闭上墙" else "开启上墙（把本机画面推给中控台）"
            setOnClickListener {
                config.wallPushEnabled = !on
                if (config.wallPushEnabled && !MediaProjectionHolder.hasAuthorization()) {
                    // 开上墙必须有截屏授权，就地补一次；授权回调里会重启服务让开关生效
                    requestMediaProjectionThenStart()
                } else {
                    startAgentServiceReal()
                }
                showStatus()
            }
        })
        return box
    }

    private fun showLicenseInput() {
        val layout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(48, 48, 48, 48)
        }
        val input = EditText(this).apply { hint = "License Key（格式 ZJ-X-XXXXXXXX，如 ZJ-F-A1B2C3D4）" }
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
            if (!AgentConfig.isValidLicenseKeyFormat(license)) {
                Toast.makeText(
                    this,
                    "License Key 格式不对，应为 ZJ-X-XXXXXXXX（例如 ZJ-F-A1B2C3D4），请检查后重新输入",
                    Toast.LENGTH_LONG,
                ).show()
                return@setOnClickListener
            }
            config.licenseKey = license
            val apiUrl = apiInput.text.toString().trim()
            if (apiUrl.isNotEmpty()) config.apiUrl = apiUrl

            startAgentService()
            showStatus()
        }
        variantConflictBanner()?.let { layout.addView(it) }
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
                val registerStatus = if (config.isRegistered) {
                    "已注册 (tier=${config.tier})"
                } else {
                    val reason = config.lastRegisterError
                    if (reason.isNotEmpty()) "未注册（原因：$reason）" else "未注册"
                }
                appendLine("注册状态: $registerStatus")
                appendLine("API: ${config.apiUrl}")
                appendLine("无障碍: ${checkSelfAccessibility(this@MainActivity).describe()}")
                appendLine("上墙: ${if (config.wallPushEnabled) "开启" else "关闭"}")
            }
        }
        val startBtn = Button(this).apply { text = "重启 Agent 服务" }
        startBtn.setOnClickListener { startAgentService() }
        val resetBtn = Button(this).apply { text = "重置 License" }
        resetBtn.setOnClickListener {
            config.licenseKey = ""
            config.wsToken = ""
            config.lastRegisterError = ""
            // 换 license 等于换机器/换租户，不能拿旧同意继续把画面往外推
            config.wallPushEnabled = false
            MediaProjectionHolder.clear()
            showLicenseInput()
        }
        variantConflictBanner()?.let { layout.addView(it) }
        layout.addView(accessibilityBanner())
        layout.addView(mediaProjectionBanner())
        layout.addView(recordAudioBanner())
        layout.addView(backgroundPermissionBanner())
        layout.addView(wallPushBanner())
        layout.addView(status)
        layout.addView(startBtn)
        layout.addView(resetBtn)
        setContentView(layout)

        // 被动"确保服务在跑"（每次进入状态页/onResume 都会走到这里）——不弹截屏授权框，
        // 避免用户拒绝过一次后每次回到 App 都被反复弹框骚扰。授权只由显式操作触发：
        // 「启动 Agent」/「重启 Agent 服务」/「授权截屏」按钮，见 startAgentService()。
        if (config.isConfigured) startAgentServiceReal()
    }

    /**
     * 显式"启动 Agent"入口：如果还没有缓存过 MediaProjection 授权，先弹一次系统
     * 截屏授权框（一次性，见 MediaProjectionHolder 头部注释），拿到结果后再真正启动服务；
     * 已授权过则直接启动，不重复弹框。
     */
    private fun startAgentService() {
        if (MediaProjectionHolder.hasAuthorization()) {
            startAgentServiceReal()
        } else {
            requestMediaProjectionThenStart()
        }
    }

    private fun requestMediaProjectionThenStart() {
        val manager = getSystemService(MEDIA_PROJECTION_SERVICE) as? MediaProjectionManager
        if (manager == null) {
            android.util.Log.w(TAG, "MediaProjectionManager unavailable — starting agent without screen capture")
            startAgentServiceReal()
            return
        }
        mediaProjectionLauncher.launch(manager.createScreenCaptureIntent())
    }

    private fun startAgentServiceReal() {
        val intent = Intent(this, AgentService::class.java)
        startForegroundService(intent)
    }

    companion object {
        private const val TAG = "MainActivity"
    }
}
