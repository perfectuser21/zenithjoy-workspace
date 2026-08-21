package com.zenithjoy.agent.uia

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * RPA 失败必须自带现场（invariant 93ed0761）。
 *
 * 0821 实证：私信 NO_SEARCH_INPUT 被"根治"过四次仍复发，结构性原因不是修得不对，
 * 是**失败原因和现场从来不在人会看的地方**——正表只有 "failed" 三个字，
 * agent 上报的诊断被塞进旁边任务表的 JSONB，screenshot_path 字段更是零接线
 * （生产 64 条私信回报 0 条有截图）。于是排查只能靠猜：我据"同源"猜着禁了两个
 * 荣耀 ROM 组件、白改三轮，读到 logcat 才发现 searchBtnFound=true、
 * 真凶是点完之后前台被抢走——先前说的"找不到搜索按钮"被现场直接推翻。
 *
 * 现场三件套里，前台包名与诊断行当天各翻过一次结论，是本刀要落库的两件。
 */
class FailureSceneTest {

    @Test
    fun `失败时必须带上前台包名与诊断行`() {
        val scene = buildFailureScene(
            errorCode = "NO_SEARCH_INPUT",
            foregroundPkg = "com.hihonor.systemmanager",
            diag = "searchBtnFound=true failure=WRONG_FOREGROUND attempts=12",
        )!!
        assertEquals("NO_SEARCH_INPUT", scene.errorCode)
        assertEquals("com.hihonor.systemmanager", scene.foregroundPkg)
        assertTrue(scene.diag!!.contains("WRONG_FOREGROUND"))
    }

    @Test
    fun `成功时不带现场——现场只为失败服务，别把正常路径也撑胖`() {
        assertNull(buildFailureScene(errorCode = "", foregroundPkg = "x", diag = "y"))
    }

    @Test
    fun `诊断行过长必须截断，防止把上报请求撑爆`() {
        val scene = buildFailureScene(
            errorCode = "NO_SEARCH_INPUT",
            foregroundPkg = "com.ss.android.ugc.aweme",
            diag = "x".repeat(FailureScene.DIAG_MAX_LEN * 3),
        )
        assertTrue(scene!!.diag!!.length <= FailureScene.DIAG_MAX_LEN)
    }

    @Test
    fun `前台包名拿不到时不能因此丢掉整个现场——诊断行仍要留下`() {
        val scene = buildFailureScene(
            errorCode = "DOUYIN_NOT_FOREGROUND",
            foregroundPkg = null,
            diag = "fgPkg 读取失败",
        )
        assertNull(scene!!.foregroundPkg)
        assertEquals("fgPkg 读取失败", scene.diag)
    }
}
