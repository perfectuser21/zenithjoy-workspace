package com.zenithjoy.agent.uia

/**
 * 「这次等待失败，值不值得问一次 AI 保底」——从散落在私信/采集链 8 个 call site 里的
 * 隐性判断收口成唯一可测的规则。
 *
 * 抽取背景：[WaitFailure.NO_ROOT] 意味着无障碍树整个不存在（服务被撤销/未绑定），
 * 这时候把空快照发给 AI 定位求助必然拿不到答案——fail-open 兜底不会崩，但白打一次
 * TOAPIS、白落一条无意义病历。私信链 4 处、采集链 2 处已经各自手写
 * `failure != WaitFailure.NO_ROOT` 来避免这个浪费；另 2 处（dm_send_button 全程无门禁、
 * dm_search_input 重试耗尽分支）当时漏写。用同一个函数替换全部 8 处，往后新接的点
 * （采集链剩余点、扫号链全部）也只需要调这一个函数，不必重新对着老代码抄一遍。
 *
 * [WaitFailure.WRONG_FOREGROUND] 和 [WaitFailure.TARGET_ABSENT] 都值得问：前者树还在只是
 * 前台被抢，AI 仍能看着当前这棵树给出候选；后者正是 AI 保底最主要覆盖的场景——页面没变
 * 但选择器过期/改版。
 */
object FailureClassifier {
    fun shouldAssist(failure: WaitFailure): Boolean = failure != WaitFailure.NO_ROOT
}
