package com.zenithjoy.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.MessageDigest

class MachineFingerprintTest {

    @Test
    fun `hostnameSlug replaces non-alphanumeric with dash`() {
        // Build.MODEL 含空格/特殊字符时 → 纯 ASCII + dash
        val slug = "Pixel 9 Pro".replace(Regex("[^a-zA-Z0-9-]"), "-")
            .replace(Regex("-+"), "-")
            .trim('-')
            .lowercase()
        assertEquals("pixel-9-pro", slug)
    }

    @Test
    fun `SHA256 fingerprint is 32 hex chars`() {
        val raw = "abc123|Pixel 9 Pro"
        val digest = MessageDigest.getInstance("SHA-256")
        val hash = digest.digest(raw.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
            .take(32)
        assertEquals(32, hash.length)
        assertTrue(hash.matches(Regex("[0-9a-f]{32}")))
    }

    @Test
    fun `same input always produces same fingerprint`() {
        fun compute(raw: String): String {
            val digest = MessageDigest.getInstance("SHA-256")
            return digest.digest(raw.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
                .take(32)
        }
        val a = compute("device-id-123|Pixel 9")
        val b = compute("device-id-123|Pixel 9")
        assertEquals(a, b)
    }

    @Test
    fun `different inputs produce different fingerprints`() {
        fun compute(raw: String): String {
            val digest = MessageDigest.getInstance("SHA-256")
            return digest.digest(raw.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
                .take(32)
        }
        val a = compute("id-1|Pixel 9")
        val b = compute("id-2|Pixel 9")
        assertTrue(a != b)
    }
}
