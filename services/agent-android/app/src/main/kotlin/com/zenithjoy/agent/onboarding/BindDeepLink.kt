package com.zenithjoy.agent.onboarding
import java.net.URLDecoder

data class BindParams(val license: String?, val api: String?)

/** 仅接受 zenithjoy://bind?...，解析 query 里的 license/api。scheme/host 不符或无 query → 空。 */
fun parseBindDeepLink(uriString: String?): BindParams {
    if (uriString.isNullOrEmpty()) return BindParams(null, null)
    val base = "zenithjoy://bind"
    if (!uriString.startsWith("$base?")) return BindParams(null, null)
    val query = uriString.substring(base.length + 1)
    val params = query.split("&").mapNotNull { pair ->
        val i = pair.indexOf('=')
        if (i <= 0) null
        else pair.substring(0, i) to runCatching { URLDecoder.decode(pair.substring(i + 1), "UTF-8") }.getOrDefault(pair.substring(i + 1))
    }.toMap()
    return BindParams(params["license"], params["api"])
}
