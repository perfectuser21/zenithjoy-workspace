package com.zenithjoy.agent.collect

/**
 * 评论按钮候选挑选（纯逻辑，可 JVM 单测）——Brain task 28cee213，2026-08-16 4号机真机实证。
 *
 * 抖音视频详情页是竖向 feed，无障碍树里同时存在上一条/下一条视频的动作栏，它们的
 * content-desc 同样是"评论N，按钮"，只是 bounds 在屏幕外（top 为负或 bottom 超屏）。
 * 旧逻辑取 DFS 第一个命中直接点 → 点在屏幕外 → 评论面板根本没开 → extracted 0 comments。
 *
 * 规则：只保留 visibleToUser 且 [top, bottom] 完全落在屏幕内的候选；多个时取 top 最大
 * （最靠下 = 当前视频的动作栏，相邻视频的要么在上方负区要么在下方超屏）；没有 → null。
 */
object CommentButtonPicker {
    data class Candidate(val index: Int, val top: Int, val bottom: Int, val visibleToUser: Boolean)

    fun pick(candidates: List<Candidate>, screenHeight: Int): Int? =
        candidates
            .filter { it.visibleToUser && it.top >= 0 && it.bottom <= screenHeight && it.bottom > it.top }
            .maxByOrNull { it.top }
            ?.index
}
