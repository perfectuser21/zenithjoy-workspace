package com.zenithjoy.agent

import org.junit.Assert.assertEquals
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * WavHeader 纯函数测试——验证给裸 PCM 字节流前置的 44 字节 WAV/RIFF header 合法。
 *
 * 真机根因 2026-07-19：AudioRecordService 之前直接把裸 PCM 字节 base64 编码返回，
 * 服务端却把它按 format: 'wav' 发给 Gemini（OpenAI 兼容 input_audio.format 只认
 * 字面值），裸 PCM 配 wav 声明会让 Gemini 解析失败/产出垃圾判断。
 */
class WavHeaderTest {

    @Test
    fun `wrapPcmAsWav生成的字节流以RIFF开头以WAVE标记`() {
        val pcm = ByteArray(100) { it.toByte() }
        val wav = WavHeader.wrapPcmAsWav(pcm, sampleRate = 16_000, channels = 1, bitsPerSample = 16)

        assertEquals(44 + pcm.size, wav.size)
        assertEquals("RIFF", String(wav.copyOfRange(0, 4), Charsets.US_ASCII))
        assertEquals("WAVE", String(wav.copyOfRange(8, 12), Charsets.US_ASCII))
        assertEquals("fmt ", String(wav.copyOfRange(12, 16), Charsets.US_ASCII))
        assertEquals("data", String(wav.copyOfRange(36, 40), Charsets.US_ASCII))
    }

    @Test
    fun `wrapPcmAsWav的采样率和位深字段与传入参数一致`() {
        val pcm = ByteArray(50)
        val wav = WavHeader.wrapPcmAsWav(pcm, sampleRate = 16_000, channels = 1, bitsPerSample = 16)

        val sampleRate = ByteBuffer.wrap(wav, 24, 4).order(ByteOrder.LITTLE_ENDIAN).int
        val channels = ByteBuffer.wrap(wav, 22, 2).order(ByteOrder.LITTLE_ENDIAN).short
        val bitsPerSample = ByteBuffer.wrap(wav, 34, 2).order(ByteOrder.LITTLE_ENDIAN).short

        assertEquals(16_000, sampleRate)
        assertEquals(1, channels.toInt())
        assertEquals(16, bitsPerSample.toInt())
    }

    @Test
    fun `wrapPcmAsWav的data块长度字段等于PCM数据实际长度`() {
        val pcm = ByteArray(777)
        val wav = WavHeader.wrapPcmAsWav(pcm, sampleRate = 16_000, channels = 1, bitsPerSample = 16)

        val dataSize = ByteBuffer.wrap(wav, 40, 4).order(ByteOrder.LITTLE_ENDIAN).int
        assertEquals(777, dataSize)
        assertEquals(pcm.toList(), wav.copyOfRange(44, wav.size).toList())
    }
}
