package com.zenithjoy.agent.collect

/**
 * Bug C：抖音分享面板选本 app 后，收到一段 ACTION_SEND text/plain 文案
 * （含中文/emoji + v.douyin.com 短链）。agent 本地抽出干净短链再上报 share_url，
 * 服务端跟随 302 拿真实 (kind,id)。逻辑与服务端 extractShareUrl 保持一致。
 */
object ShareLinkExtractor {

    private val SHORT_LINK = Regex("""https?://v\.douyin\.com/(?:i/)?[A-Za-z0-9]+/?""")

    /** 从分享文案抽出第一个 v.douyin.com 短链；无则 null（尾部中文标点/空白天然被正则排除） */
    fun extract(text: String?): String? {
        if (text.isNullOrEmpty()) return null
        return SHORT_LINK.find(text)?.value
    }
}
