package com.zenithjoy.agent.uia

/**
 * RPA 失败现场 —— 让失败自己把证据交出来，而不是等人想起来去 adb 抓。
 *
 * 依据 invariant 93ed0761。0821 的账：私信 NO_SEARCH_INPUT 被"根治"过四次仍复发，
 * 结构性原因不是修得不对，是**失败原因和现场从来不在人会看的地方**——正表只有
 * "failed" 三个字，诊断被塞进旁边任务表的 JSONB。于是每次排查都只能靠猜。
 *
 * 当天真正翻案的就是这两件：
 *   前台包名 → 拍到荣耀全局搜索接走了输入、系统管家广告盖在抖音上
 *   诊断行   → searchBtnFound=true，直接推翻了"找不到搜索按钮"这个错判
 * 所以它们必须跟着 error_code 一起落进正表，不落就等于没有。
 */
data class FailureScene(
    val errorCode: String,
    /** 判失败那一刻的前台包名。拿不到就是 null——但**不能因此丢掉整个现场**。 */
    val foregroundPkg: String?,
    /** 该错误码的诊断行（等待轮数/失败分类/找到了什么没找到什么）。 */
    val diag: String?,
    /**
     * 失败那一刻的无障碍树快照（AI on-call 刀1）。截断已在 UiTreeSnapshot 序列化时
     * 完成（64KB/30层/800节点），这里只做透传；拿不到就是 null，同样不丢现场。
     */
    val uiTree: String? = null,
) {
    companion object {
        /** 诊断行落库上限：够看清失败形态，又不会把上报请求撑爆。 */
        const val DIAG_MAX_LEN = 512
    }
}

/**
 * 组装现场。**成功路径返回 null** —— 现场只为失败服务，别把正常上报也撑胖。
 */
fun buildFailureScene(
    errorCode: String,
    foregroundPkg: String?,
    diag: String?,
    uiTree: String? = null,
): FailureScene? {
    if (errorCode.isBlank()) return null
    return FailureScene(
        errorCode = errorCode,
        foregroundPkg = foregroundPkg?.takeIf { it.isNotBlank() },
        diag = diag?.takeIf { it.isNotBlank() }?.take(FailureScene.DIAG_MAX_LEN),
        uiTree = uiTree?.takeIf { it.isNotBlank() },
    )
}
