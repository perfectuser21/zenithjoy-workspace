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
 * Bitmap 全部是 Android 运行时类），真机验证走 xian-rog（见 ScreenCaptureRealTest.kt 头部
 * 注释：可测的部分已抽成 ScreenCaptureService.isBlankImage 等纯函数）。
 *
 * 流程：
 *   1. 用 MediaProjectionHolder 换出的 MediaProjection 建一个离屏 VirtualDisplay，
 *      surface 指向 ImageReader。
 *   2. acquireLatestImage() 取一帧（带短重试，MediaProjection 刚建立时首帧常常还没到）。
 *   3. image.close() 立即释放（合同要求：不持有超过一帧）。
 *   4. 采样像素校验非全黑非全零（isBlankImage）—— DRM/SECURE flag 会让某些 App 界面
 *      静默返回黑屏，此时判定截图无效，直接返回 null 让上层标 pending。
 *   5. 缩放到最长边 ≤720p，压缩 JPEG quality=70，Base64 编码。
 *   6. finally 里释放 VirtualDisplay + ImageReader（重量级系统资源，绝不能泄漏）。
 */
object ScreenCaptureReal {
    private const val TAG = "ScreenCaptureReal"
    private const val JPEG_QUALITY = 70
    private const val MAX_DIMENSION_PX = 720
    private const val ACQUIRE_RETRY_COUNT = 5
    private const val ACQUIRE_RETRY_DELAY_MS = 80L

    /**
     * 构造真正会截屏的 captureImpl，供 [ScreenCaptureService] 生产环境使用。
     * mediaProjectionProvider 每次调用都重新取（懒创建/复用同一实例，见 MediaProjectionHolder）。
     */
    fun buildCaptureImpl(context: Context, mediaProjectionProvider: () -> MediaProjection?): () -> String? = {
        captureOnce(context, mediaProjectionProvider())
    }

    private fun captureOnce(context: Context, projection: MediaProjection?): String? {
        if (projection == null) {
            android.util.Log.w(TAG, "no MediaProjection instance — not authorized yet")
            return null
        }
        val metrics = DisplayMetrics()
        val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as? android.view.WindowManager
        windowManager?.defaultDisplay?.getRealMetrics(metrics)
        val width = metrics.widthPixels.takeIf { it > 0 } ?: 1080
        val height = metrics.heightPixels.takeIf { it > 0 } ?: 1920
        val density = metrics.densityDpi.takeIf { it > 0 } ?: DisplayMetrics.DENSITY_DEFAULT

        var virtualDisplay: VirtualDisplay? = null
        val imageReader = ImageReader.newInstance(width, height, android.graphics.PixelFormat.RGBA_8888, 2)
        try {
            virtualDisplay = projection.createVirtualDisplay(
                "zj-content-judgment-capture",
                width, height, density,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.surface, null, null,
            )

            val image = acquireImageWithRetry(imageReader) ?: run {
                android.util.Log.w(TAG, "acquireLatestImage returned null after retries")
                return null
            }
            val bitmap = try {
                imageToBitmap(image, width, height)
            } finally {
                image.close() // 合同要求：不持有超过一帧，取完立即释放
            }

            if (bitmap == null) return null
            if (isBitmapBlank(bitmap)) {
                android.util.Log.w(TAG, "captured frame is blank/black — likely DRM/SECURE flag, discarding")
                return null
            }

            return compressToBase64(bitmap)
        } catch (e: Exception) {
            android.util.Log.w(TAG, "captureOnce failed: ${e.message}")
            return null
        } finally {
            virtualDisplay?.release()
            imageReader.close()
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
