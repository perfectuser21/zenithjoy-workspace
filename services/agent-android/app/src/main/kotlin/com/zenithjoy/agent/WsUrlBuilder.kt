package com.zenithjoy.agent

import java.net.URLEncoder

/**
 * WS 连接 URL 拼装（纯函数，无 Android 依赖，便于 JVM 单测）。
 *
 * 服务端 authenticateWsToken 校验重连用的 hex ws_token 时，需要 machine_id
 * 反查 license_machines JOIN licenses 拿到 license_id 才能做 HMAC 校验；
 * 不带 machine_id 时 hex token 永远走不通验证，断线重连必然 401
 * （2026-07-27 Path2 安卓验收实测：staging 490/495 次 /agent-ws 请求 401）。
 */
object WsUrlBuilder {
    fun build(apiUrl: String, token: String, machineId: String): String {
        val encodedToken = URLEncoder.encode(token, "UTF-8")
        val encodedMachineId = URLEncoder.encode(machineId, "UTF-8")
        return "$apiUrl?token=$encodedToken&machine_id=$encodedMachineId"
    }
}
