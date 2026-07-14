package com.zenithjoy.agent

import android.content.Context
import android.graphics.Bitmap
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.util.DisplayMetrics
import java.io.ByteArrayOutputStream

/**
 * ScreenCaptureReal — 生产环境真实截图实现（VirtualDisplay + ImageReader 单帧捕获）。
 *
 * 不在纯 JVM 单测里跑（依赖真实 Android SDK：MediaProjection/VirtualDisplay/ImageReader/
 * Bitmap 全部是 Android 运行时类），真机验证走 xian-rog。可测的部分已抽成
 * ScreenCaptureService.isBlankImage / CaptureSessionManager 等纯逻辑单测。
 *
 * ⚠️ Android 14 约束（真机 logcat 实锤）：**禁止在同一 MediaProjection 实例上多次
 * createVirtualDisplay**——旧实现每次截图都新建+释放 VirtualDisplay，第二次即崩
 * （"Don't take multiple captures by invoking createVirtualDisplay multiple times on the
 * same instance"）并把 projection stop 掉 → 之后全部判定截图 no MediaProjection instance
 * → judgment_status 恒 pending。
 *
 * 修复：VirtualDisplay + ImageReader 按 projection **只建一次、常驻复用**（[CaptureSessionManager]
 * 守纪律），每次截图只从常驻 ImageReader acquireLatestImage 抓一帧；projection 变了
 * (重新授权换出新实例)或 [releaseSession] 才拆掉重量级资源。
 */
object ScreenCaptureReal {
    private const val TAG = "ScreenCaptureReal"
    private const val JPEG_QUALITY = 70
    private const val MAX_DIMENSION_PX = 720
    private const val ACQUIRE_RETRY_COUNT = 5
    private const val ACQUIRE_RETRY_DELAY_MS = 80L

    /** 常驻截图会话：一个 projection 对应一个 VirtualDisplay + ImageReader，反复抓帧不重建。 */
    private class Session(
        val virtualDisplay: VirtualDisplay,
        val imageReader: ImageReader,
        val width: Int,
        val height: Int,
    ) {
        fun release() {
            try { virtualDisplay.release() } catch (_: Exception) {}
            try { imageReader.close() } catch (_: Exception) {}
        }
    }

    @Volatile private var manager: CaptureSessionManager<Session>? = null

    /**
     * 构造真正会截屏的 captureImpl，供 [ScreenCaptureService] 生产环境使用。
     * mediaProjectionProvider 每次调用都重新取（懒创建/复用同一实例，见 MediaProjectionHolder）。
     * 内部用 [CaptureSessionManager] 按 projection 复用 VirtualDisplay/ImageReader（A14 纪律）。
     */
    fun buildCaptureImpl(context: Context, mediaProjectionProvider: () -> MediaProjection?): () -> String? {
        val mgr = CaptureSessionManager<Session>(
            factory = { token -> createSession(context, token as MediaProjection) },
            releaser = { it.release() },
        )
        manager = mgr
        return { captureFrame(context, mgr, mediaProjectionProvider()) }
    }

    /** projection 停止 / 用户重置授权时调，拆掉常驻 VirtualDisplay/ImageReader（由 MediaProjectionHolder 触发）。 */
    fun releaseSession() {
        manager?.release()
    }

    private fun captureFrame(
        context: Context,
        mgr: CaptureSessionManager<Session>,
        projection: MediaProjection?,
    ): String? {
        if (projection == null) {
            android.util.Log.w(TAG, "no MediaProjection instance — not authorized yet")
            return null
        }
        // 关键：同一 projection 复用会话（只 createVirtualDisplay 一次，满足 A14）
        val session = mgr.sessionFor(projection) ?: run {
            android.util.Log.w(TAG, "createVirtualDisplay session unavailable")
            return null
        }
        return try {
            val image = acquireImageWithRetry(session.imageReader) ?: run {
                android.util.Log.w(TAG, "acquireLatestImage returned null after retries")
                return null
            }
            val bitmap = try {
                imageToBitmap(image, session.width, session.height)
            } finally {
                image.close() // 合同要求：不持有超过一帧，取完立即释放（但不拆 VirtualDisplay）
            }
            if (bitmap == null) return null
            if (isBitmapBlank(bitmap)) {
                android.util.Log.w(TAG, "captured frame is blank/black — likely DRM/SECURE flag, discarding")
                return null
            }
            compressToBase64(bitmap)
        } catch (e: Exception) {
            android.util.Log.w(TAG, "captureFrame failed: ${e.message}")
            // 抓帧异常(如 VirtualDisplay 已失效) → 拆会话,下次换出新 projection 时重建
            mgr.release()
            null
        }
    }

    /** 为给定 projection 建常驻 VirtualDisplay + ImageReader（每 projection 只调一次）。 */
    private fun createSession(context: Context, projection: MediaProjection): Session? {
        val metrics = DisplayMetrics()
        val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as? android.view.WindowManager
        @Suppress("DEPRECATION")
        windowManager?.defaultDisplay?.getRealMetrics(metrics)
        val width = metrics.widthPixels.takeIf { it > 0 } ?: 1080
        val height = metrics.heightPixels.takeIf { it > 0 } ?: 1920
        val density = metrics.densityDpi.takeIf { it > 0 } ?: DisplayMetrics.DENSITY_DEFAULT

        val imageReader = ImageReader.newInstance(width, height, android.graphics.PixelFormat.RGBA_8888, 2)
        return try {
            val virtualDisplay = projection.createVirtualDisplay(
                "zj-content-judgment-capture",
                width, height, density,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.surface, null, null,
            ) ?: run {
                imageReader.close()
                return null
            }
            Session(virtualDisplay, imageReader, width, height)
        } catch (e: Exception) {
            android.util.Log.w(TAG, "createSession failed: ${e.message}")
            try { imageReader.close() } catch (_: Exception) {}
            null
        }
    }

    private fun acquireImageWithRetry(imageReader: ImageReader): Image? {
        repeat(ACQUIRE_RETRY_COUNT) {
            val image = imageReader.acquireLatestImage()
            if (image != null) return image
            Thread.sleep(ACQUIRE_RETRY_DELAY_MS)
        }
        return null
    }

    private fun imageToBitmap(image: Image, width: Int, height: Int): Bitmap? {
        return try {
            val plane = image.planes[0]
            val buffer = plane.buffer
            val pixelStride = plane.pixelStride
            val rowStride = plane.rowStride
            val rowPadding = rowStride - pixelStride * width
            val bitmap = Bitmap.createBitmap(
                width + rowPadding / pixelStride, height, Bitmap.Config.ARGB_8888,
            )
            bitmap.copyPixelsFromBuffer(buffer)
            if (rowPadding == 0) bitmap else Bitmap.createBitmap(bitmap, 0, 0, width, height)
        } catch (e: Exception) {
            android.util.Log.w(TAG, "imageToBitmap failed: ${e.message}")
            null
        }
    }

    /** 采样若干像素点（九宫格式），复用 ScreenCaptureService.isBlankImage 纯函数判定。 */
    private fun isBitmapBlank(bitmap: Bitmap): Boolean {
        val w = bitmap.width
        val h = bitmap.height
        if (w <= 0 || h <= 0) return true
        val xs = listOf(0.1, 0.3, 0.5, 0.7, 0.9).map { (it * (w - 1)).toInt().coerceIn(0, w - 1) }
        val ys = listOf(0.1, 0.3, 0.5, 0.7, 0.9).map { (it * (h - 1)).toInt().coerceIn(0, h - 1) }
        val samples = IntArray(xs.size * ys.size)
        var i = 0
        for (x in xs) for (y in ys) samples[i++] = bitmap.getPixel(x, y)
        return ScreenCaptureService.isBlankImage(samples)
    }

    private fun compressToBase64(bitmap: Bitmap): String {
        val scaled = scaleDownIfNeeded(bitmap)
        val stream = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, stream)
        return android.util.Base64.encodeToString(stream.toByteArray(), android.util.Base64.NO_WRAP)
    }

    private fun scaleDownIfNeeded(bitmap: Bitmap): Bitmap {
        val longSide = maxOf(bitmap.width, bitmap.height)
        if (longSide <= MAX_DIMENSION_PX) return bitmap
        val scale = MAX_DIMENSION_PX.toFloat() / longSide
        val newWidth = (bitmap.width * scale).toInt().coerceAtLeast(1)
        val newHeight = (bitmap.height * scale).toInt().coerceAtLeast(1)
        return Bitmap.createScaledBitmap(bitmap, newWidth, newHeight, true)
    }
}
