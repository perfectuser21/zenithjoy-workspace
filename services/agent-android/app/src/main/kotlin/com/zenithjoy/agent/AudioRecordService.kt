package com.zenithjoy.agent

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.util.Base64
import java.io.ByteArrayOutputStream

/**
 * AudioRecordService — MediaProjection 音频采集（commit-3 Green skeleton）
 *
 * Spike 结论：one-time authorization — 启动时弹一次权限框，缓存 MediaProjection 实例，
 * 后续录音无需再弹。（见 spike-media-projection.md）
 *
 * 职责：
 *   - 通过 AudioPlaybackCaptureConfiguration 捕获系统音频（抖音视频播放声）
 *   - 录制约 3 秒 PCM 片段（16kHz，单声道，16bit）
 *   - 返回 base64 编码的 PCM 数据，供 ContentJudgmentService 上报
 *
 * 使用约束：
 *   - 需要 Android 10+（API 29+）
 *   - 必须在 foreground service 中调用（持有 MediaProjection 实例）
 *   - 不得在主线程调用（阻塞约 3s）
 */
class AudioRecordService(
    private val mediaProjection: MediaProjection,
) {
    companion object {
        private const val TAG = "AudioRecordService"
        private const val SAMPLE_RATE = 16_000       // 16kHz
        private const val CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
        private const val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT

        // 用户2026-07-17拍板（判定点1d078987）：固定只录开头20秒，不管视频总长多少——
        // 短视频/带货类内容创作者被平台算法逼着把钩子放在开头3-15秒，20秒足够覆盖内容
        // 主旨判断相关性；成本时间恒定不受视频总长影响（1分钟和1小时视频耗时一样）。
        internal const val RECORD_DURATION_MS = 20_000L
    }

    /**
     * 捕获当前系统音频（抖音播放声），返回 base64 编码的 PCM 片段。
     * 录制 3 秒后自动停止。
     *
     * @return base64 PCM 字符串，失败时返回 null
     */
    fun captureAudioSnippet(): String? {
        return try {
            val config = AudioPlaybackCaptureConfiguration.Builder(mediaProjection)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .build()

            val bufferSize = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT)
            val audioRecord = AudioRecord.Builder()
                .setAudioPlaybackCaptureConfig(config)
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setSampleRate(SAMPLE_RATE)
                        .setChannelMask(CHANNEL_CONFIG)
                        .setEncoding(AUDIO_FORMAT)
                        .build()
                )
                .setBufferSizeInBytes(bufferSize)
                .build()

            val outputStream = ByteArrayOutputStream()
            val buffer = ByteArray(bufferSize)
            val startMs = System.currentTimeMillis()

            audioRecord.startRecording()
            try {
                while (System.currentTimeMillis() - startMs < RECORD_DURATION_MS) {
                    val read = audioRecord.read(buffer, 0, buffer.size)
                    if (read > 0) {
                        outputStream.write(buffer, 0, read)
                    }
                }
            } finally {
                audioRecord.stop()
                audioRecord.release()
            }

            Base64.encodeToString(outputStream.toByteArray(), Base64.NO_WRAP)
        } catch (e: Exception) {
            logW("captureAudioSnippet failed: ${e.message}")
            null
        }
    }

    private fun logW(message: String) {
        try {
            android.util.Log.w(TAG, message)
        } catch (_: RuntimeException) {
            // JVM 测试环境下吞掉
        }
    }
}
