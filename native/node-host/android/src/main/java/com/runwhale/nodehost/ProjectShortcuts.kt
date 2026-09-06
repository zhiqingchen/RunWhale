package com.runwhale.nodehost

import android.content.Context
import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.BitmapFactory
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import java.io.File

internal object ProjectShortcuts {
  fun supported(context: Context): Boolean = Build.VERSION.SDK_INT >= 26 &&
    context.getSystemService(ShortcutManager::class.java)?.isRequestPinShortcutSupported == true

  fun pin(context: Context, projectId: String, name: String, iconUri: String): String {
    require(NativePreviewProjectScope.PROJECT_ID_PATTERN.matches(projectId)) { "Invalid project identifier" }
    val label = name.trim()
    require(label.isNotEmpty() && label.length <= 40 && label.none { it.code < 32 || it.code == 127 }) { "Invalid shortcut name" }
    if (!supported(context)) return "unsupported"
    val uri = Uri.parse(iconUri)
    require(uri.scheme == "file") { "Shortcut image must be a local file" }
    val file = File(requireNotNull(uri.path)).canonicalFile
    val root = File(context.filesDir, "project-shortcuts/$projectId").canonicalFile
    require(file.parentFile == root && file.isFile && file.length() <= 2 * 1024 * 1024) { "Invalid shortcut image" }
    val image = file.readBytes()
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(image, 0, image.size, bounds)
    require(bounds.outWidth in 1..1024 && bounds.outHeight in 1..1024) { "Invalid shortcut image dimensions" }
    val bitmap = requireNotNull(BitmapFactory.decodeByteArray(image, 0, image.size)) { "Could not read shortcut image" }
    try {
      val intent = requireNotNull(context.packageManager.getLaunchIntentForPackage(context.packageName)) { "App launcher is unavailable" }
      intent.action = Intent.ACTION_VIEW
      intent.data = Uri.parse("runwhale://run/$projectId")
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      val shortcut = ShortcutInfo.Builder(context, "project-$projectId")
        .setShortLabel(label)
        .setLongLabel(label)
        .setIcon(Icon.createWithBitmap(bitmap))
        .setIntent(intent)
        .build()
      val manager = requireNotNull(context.getSystemService(ShortcutManager::class.java))
      if (manager.pinnedShortcuts.any { it.id == shortcut.id }) {
        check(manager.updateShortcuts(listOf(shortcut))) { "Could not update shortcut" }
        manager.enableShortcuts(listOf(shortcut.id))
        return "updated"
      }
      return if (manager.requestPinShortcut(shortcut, null)) "requested" else "unsupported"
    } finally {
      bitmap.recycle()
    }
  }
}
