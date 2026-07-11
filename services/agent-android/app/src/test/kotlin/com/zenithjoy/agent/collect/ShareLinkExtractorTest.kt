package com.zenithjoy.agent.collect

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Bug C 回归（agent 端纯函数）：抖音分享面板选本 app 后，收到的是一段
 * ACTION_SEND text/plain 文案（含中文/emoji + v.douyin.com 短链）。
 * agent 必须本地抽出干净短链再上报 share_url，服务端跟随 302 拿真实 (kind,id)。
 * 这是逻辑接缝 → CI 纯函数守卫。
 */
class ShareLinkExtractorTest {

    // TC-S01: 从含中文前后缀的分享文案抽出 v.douyin.com 短链
    @Test
    fun `extracts short link from share text with chinese prefix and suffix`() {
        val text = "7.68 复制打开抖音，看看【某某的作品】https://v.douyin.com/iRNBho6G/ 快来！"
        assertEquals("https://v.douyin.com/iRNBho6G/", ShareLinkExtractor.extract(text))
    }

    // TC-S02: 容忍 emoji / 换行，抽第一个短链
    @Test
    fun `extracts first short link tolerating emoji and newlines`() {
        val text = "🔥超好看\nhttps://v.douyin.com/AbC123\n👇"
        assertEquals("https://v.douyin.com/AbC123", ShareLinkExtractor.extract(text))
    }

    // TC-S03: 去掉尾部中文标点
    @Test
    fun `strips trailing chinese punctuation`() {
        assertEquals("https://v.douyin.com/xYz789", ShareLinkExtractor.extract("看这个 https://v.douyin.com/xYz789。"))
    }

    // TC-S04: 无短链 → null
    @Test
    fun `returns null when no short link`() {
        assertNull(ShareLinkExtractor.extract("这是一段没有链接的文字"))
        assertNull(ShareLinkExtractor.extract(""))
    }

    // TC-S05: 非 v.douyin.com 域名不抽（防钓鱼/防误上报）
    @Test
    fun `does not extract non douyin domains`() {
        assertNull(ShareLinkExtractor.extract("https://evil.com/v.douyin.com/x"))
    }

    // TC-S06: 抽出带 /i/ 路径段的短链变体
    @Test
    fun `extracts short link with i path segment`() {
        val text = "复制打开抖音 https://v.douyin.com/i/AbC123/ 看看"
        assertEquals("https://v.douyin.com/i/AbC123/", ShareLinkExtractor.extract(text))
    }
}
