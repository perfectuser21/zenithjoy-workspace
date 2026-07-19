package com.zenithjoy.agent.collect

/**
 * CardTitleExtractor — 纯 Kotlin 卡片标题提取（无 Android 依赖，对齐 CardClassifier
 * 的纯函数可测试设计）。
 *
 * best-effort 启发式：卡片子树里最长的一条文本通常就是标题/文案 TextView
 * （真机 uiautomator dump 实测验证，见 DouyinCardClassifyTest 样本）——不保真，
 * 但优于完全没有 title 信号。
 */
object CardTitleExtractor {
    fun pickTitle(texts: List<String>): String? = texts.maxByOrNull { it.length }
}
