package com.zenithjoy.agent

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * 守卫：真机验证时复现——AgentRegistrar 请求 ws://<tailscale-ip>:5200/agent-ws 时
 * 被系统拦截，报 "CLEARTEXT communication ... not permitted by network security
 * policy"。App 的 API URL 由用户自行填写（内网部署/Tailscale IP/本地测试机都合法），
 * 不能预先枚举域名白名单，所以要在 manifest 挂 network_security_config 放开明文流量。
 */
class NetworkSecurityConfigTest {

    private fun manifestText(): String {
        val candidates = listOf(
            File("src/main/AndroidManifest.xml"),
            File("app/src/main/AndroidManifest.xml"),
        )
        val file = candidates.firstOrNull { it.exists() }
            ?: error("AndroidManifest.xml not found in ${candidates.map { it.absolutePath }}")
        return file.readText()
    }

    private fun networkSecurityConfigText(): String {
        val candidates = listOf(
            File("src/main/res/xml/network_security_config.xml"),
            File("app/src/main/res/xml/network_security_config.xml"),
        )
        val file = candidates.firstOrNull { it.exists() }
            ?: error("network_security_config.xml not found in ${candidates.map { it.absolutePath }}")
        return file.readText()
    }

    @Test
    fun `manifest references network_security_config`() {
        assertTrue(
            manifestText().contains("android:networkSecurityConfig=\"@xml/network_security_config\""),
        )
    }

    @Test
    fun `network_security_config permits cleartext traffic`() {
        assertTrue(
            networkSecurityConfigText().contains("cleartextTrafficPermitted=\"true\""),
        )
    }
}
