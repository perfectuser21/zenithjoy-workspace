package com.zenithjoy.agent.collect

sealed class CollectJob {
    data class Stage1(val taskId: String, val keyword: String) : CollectJob()
    data class Stage2(val taskId: String, val videoUrl: String, val videoId: String) : CollectJob()
    data class Cancel(val taskId: String) : CollectJob()
}
