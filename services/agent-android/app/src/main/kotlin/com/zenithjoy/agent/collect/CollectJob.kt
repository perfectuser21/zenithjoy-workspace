package com.zenithjoy.agent.collect

sealed class CollectJob {
    abstract val taskId: String

    data class Stage1(override val taskId: String, val keyword: String) : CollectJob()
    data class Stage2(override val taskId: String, val videoUrl: String, val videoId: String) : CollectJob()
    data class Cancel(override val taskId: String) : CollectJob()
}
