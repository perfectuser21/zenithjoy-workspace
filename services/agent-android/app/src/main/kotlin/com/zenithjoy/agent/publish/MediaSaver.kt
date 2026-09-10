package com.zenithjoy.agent.publish

import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File

/**
 * 发布素材落相册（刀A，line01 智能发布基座段）。
 *
 * 双路径（设计 spec 决策4）：
 *   - API 29+（Q+）：MediaStore insert + 写流 + IS_PENDING 置回 0 的官方流程，
 *     无需任何存储权限；按 mime 判 Images/Video collection；RELATIVE_PATH 指到
 *     DCIM/Camera——各平台 App 的相册选择器默认都看这里。
 *   - API 26-28：直接写 /sdcard/DCIM/Camera + MediaScannerConnection.scanFile
 *     通知媒体库；需要 WRITE_EXTERNAL_STORAGE（manifest 已声明 maxSdkVersion=28，
 *     Q+ 不多要权限）。
 *
 * 文件名用发布包 file_name（上传时已是相机风格），与 AI 执行器在相册里按名领取素材
 * 的约定对齐。
 */
object MediaSaver {

    private const val TAG = "MediaSaver"

    /** legacy 相册目录：写死 Camera 子目录，与 Q+ 路径的 RELATIVE_PATH 保持同一落点。 */
    private const val LEGACY_DCIM_CAMERA = "DCIM/Camera"

    /**
     * 把 cache 里的临时文件复制进系统相册。
     * @return false = 落相册失败（调用方按 fail-visible 语义回 failed 回执）。
     */
    fun saveToGallery(context: Context, file: File, fileName: String, mimeType: String?): Boolean {
        val mime = mimeType?.takeIf { it.isNotBlank() } ?: guessMimeType(fileName)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            saveViaMediaStore(context, file, fileName, mime)
        } else {
            saveLegacyDcim(context, file, fileName, mime)
        }
    }

    /** API 29+：MediaStore insert → 写流 → IS_PENDING=0。失败删掉半截 pending 行。 */
    private fun saveViaMediaStore(context: Context, file: File, fileName: String, mime: String): Boolean {
        val collection = if (mime.startsWith("video/")) {
            MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        } else {
            MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        }
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, fileName)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DCIM + "/Camera")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val resolver = context.contentResolver
        val uri = resolver.insert(collection, values) ?: run {
            logW("MediaStore insert 返回 null：$fileName mime=$mime")
            return false
        }
        return try {
            val out = resolver.openOutputStream(uri) ?: run {
                logW("MediaStore openOutputStream 返回 null：$fileName")
                resolver.delete(uri, null, null)
                return false
            }
            out.use { stream -> file.inputStream().use { it.copyTo(stream) } }
            values.clear()
            values.put(MediaStore.MediaColumns.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            true
        } catch (e: Exception) {
            logW("MediaStore 写入失败 $fileName: ${e.message}")
            // 写了半截的 pending 行必须删掉，否则相册残留看不见但占空间的僵尸条目。
            try {
                resolver.delete(uri, null, null)
            } catch (_: Exception) {
            }
            false
        }
    }

    /** API 26-28：写 /sdcard/DCIM/Camera + MediaScannerConnection.scanFile。 */
    private fun saveLegacyDcim(context: Context, file: File, fileName: String, mime: String): Boolean {
        return try {
            @Suppress("DEPRECATION")
            val dir = File(Environment.getExternalStorageDirectory(), LEGACY_DCIM_CAMERA)
            if (!dir.exists() && !dir.mkdirs()) {
                logW("legacy 相册目录创建失败：${dir.absolutePath}")
                return false
            }
            val dest = File(dir, fileName)
            file.copyTo(dest, overwrite = true)
            // 不 scan 相册就看不见文件——媒体库只认扫描过的条目。
            MediaScannerConnection.scanFile(context, arrayOf(dest.absolutePath), arrayOf(mime), null)
            true
        } catch (e: Exception) {
            logW("legacy 落相册失败 $fileName: ${e.message}")
            false
        }
    }

    /** mime 缺失时按扩展名兜底——只影响 Images/Video collection 选择，猜不中也能落图片区。 */
    internal fun guessMimeType(fileName: String): String {
        return when (fileName.substringAfterLast('.', "").lowercase()) {
            "mp4" -> "video/mp4"
            "mov" -> "video/quicktime"
            "png" -> "image/png"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            else -> "image/jpeg"
        }
    }

    private fun logW(message: String) {
        try {
            android.util.Log.w(TAG, message)
        } catch (_: RuntimeException) {
        }
    }
}
