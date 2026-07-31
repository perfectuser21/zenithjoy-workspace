package com.zenithjoy.agent.collect

/** 取消必须先让运行中的采集安全退出，再允许上报 cancelled。 */
class AcquisitionCancellationCoordinator(
    private val safeExit: (String) -> Boolean,
    private val reportCancel: (String) -> CollectReporter.ReportResult,
) {
    fun cancel(taskId: String): CollectReporter.ReportResult? {
        if (!safeExit(taskId)) return null
        return reportCancel(taskId)
    }
}
