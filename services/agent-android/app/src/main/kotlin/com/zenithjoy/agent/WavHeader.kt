package com.zenithjoy.agent

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * WavHeader — 纯 Kotlin WAV/RIFF header 封装（无 Android 依赖，对齐 CardClassifier 的
 * 纯函数可测试设计）。
 *
 * 用途：AudioRecordService 录制得到的是裸 PCM 字节流，服务端 content-judgment.ts 按
 * `format: 'wav'` 声明发给 Gemini（OpenAI 兼容 input_audio.format 只认字面值）——
 * 这里把 44 字节标准 WAV header 前置到 PCM 数据前，使字节流真的是合法 WAV 文件。
 */
object WavHeader {
    private const val HEADER_SIZE = 44
    private const val PCM_FMT_CHUNK_SIZE = 16
    private const val AUDIO_FORMAT_PCM: Short = 1

    fun wrapPcmAsWav(pcm: ByteArray, sampleRate: Int, channels: Int, bitsPerSample: Int): ByteArray {
        val byteRate = sampleRate * channels * bitsPerSample / 8
        val blockAlign = channels * bitsPerSample / 8
        val dataSize = pcm.size

        val header = ByteBuffer.allocate(HEADER_SIZE).order(ByteOrder.LITTLE_ENDIAN)
        header.put("RIFF".toByteArray(Charsets.US_ASCII))
        header.putInt(36 + dataSize)
        header.put("WAVE".toByteArray(Charsets.US_ASCII))
        header.put("fmt ".toByteArray(Charsets.US_ASCII))
        header.putInt(PCM_FMT_CHUNK_SIZE)
        header.putShort(AUDIO_FORMAT_PCM)
        header.putShort(channels.toShort())
        header.putInt(sampleRate)
        header.putInt(byteRate)
        header.putShort(blockAlign.toShort())
        header.putShort(bitsPerSample.toShort())
        header.put("data".toByteArray(Charsets.US_ASCII))
        header.putInt(dataSize)

        return header.array() + pcm
    }
}
