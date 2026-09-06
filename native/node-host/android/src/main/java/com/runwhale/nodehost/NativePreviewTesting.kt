package com.runwhale.nodehost

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Bundle
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.text.InputType
import android.util.Base64
import android.view.MotionEvent
import android.view.PixelCopy
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import android.webkit.WebView
import android.widget.EditText
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.lang.ref.WeakReference
import java.util.UUID
import kotlin.math.min

internal class NativePreviewTesting {
  private data class Target(val view: WeakReference<View>, val description: String)
  private val targets = mutableMapOf<String, Target>()
  private val logs = ArrayDeque<JSONObject>()
  private var sequence = 0L
  private var snapshotId = ""
  var root: ViewGroup? = null
  var projectId: String? = null
  var sourceId: String? = null

  @Synchronized fun log(level: String, message: String) {
    logs.addLast(JSONObject().put("sequence", ++sequence).put("timestamp", System.currentTimeMillis())
      .put("level", if (level in listOf("debug", "info", "warn", "error")) level else "info").put("message", message.take(1024)))
    if (logs.size > 100) logs.removeFirst()
  }

  @Synchronized private fun readLogs(after: Long): JSONObject = JSONObject()
    .put("logs", JSONArray(logs.filter { it.getLong("sequence") > after }))
    .put("nextSequence", sequence).put("gap", logs.firstOrNull()?.getLong("sequence")?.let { after < it - 1 } ?: false)

  fun execute(activity: Activity, command: JSONObject, complete: (String) -> Unit) {
    try {
      val preview = requireNotNull(root) { "Native Preview is not mounted" }
      check(preview.isShown && preview.hasWindowFocus()) { "Keep the Native Preview visible while testing" }
      when (command.getString("kind")) {
        "logs" -> complete(result(readLogs(command.optLong("afterSequence", 0))))
        "screenshot" -> capture(activity, preview, complete)
        "inspect" -> {
          targets.clear()
          snapshotId = UUID.randomUUID().toString()
          val output = JSONArray()
          val queue = ArrayDeque<Pair<View, String?>>()
          queue.add(preview to null)
          while (queue.isNotEmpty() && output.length() < 250) {
            val (view, parent) = queue.removeFirst()
            val id = "n${output.length() + 1}"
            val node = describe(view, preview).put("id", id)
            if (parent != null) node.put("parentId", parent)
            output.put(node)
            targets[id] = Target(WeakReference(view), describe(view, preview).toString())
            if (view is ViewGroup && view !is WebView) for (index in 0 until view.childCount) queue.add(view.getChildAt(index) to id)
          }
          complete(result(JSONObject().put("snapshotId", snapshotId).put("nodes", output)
            .put("truncated", queue.isNotEmpty()).put("viewport", viewport(preview))))
        }
        "action" -> {
          check(command.getString("snapshotId") == snapshotId) { "The node snapshot is stale. Inspect again." }
          val target = requireNotNull(targets[command.getString("nodeId")]) { "Unknown node. Inspect again." }
          val view = requireNotNull(target.view.get()) { "The target was removed. Inspect again." }
          val node = describe(view, preview)
          check(node.toString() == target.description && node.getBoolean("visible")) { "The target changed. Inspect again." }
          val action = command.getString("action")
          check(node.getJSONArray("actions").toString().contains("\"$action\"")) { "This node does not support that action" }
          snapshotId = ""
          when (action) {
            "fill" -> {
              val text = command.getString("text")
              check(text.length <= 4096) { "Input is too long" }
              val input = view as EditText
              input.requestFocus()
              input.setText(text)
              input.setSelection(input.text.length)
            }
            "press" -> {
              val origin = IntArray(2).also(preview::getLocationOnScreen)
              val position = IntArray(2).also(view::getLocationOnScreen)
              val x = position[0] - origin[0] + view.width / 2f
              val y = position[1] - origin[1] + view.height / 2f
              check(x in 0f..preview.width.toFloat() && y in 0f..preview.height.toFloat()) { "Target center is outside the Preview viewport" }
              val now = SystemClock.uptimeMillis()
              val down = MotionEvent.obtain(now, now, MotionEvent.ACTION_DOWN, x, y, 0)
              val up = MotionEvent.obtain(now, now + 50, MotionEvent.ACTION_UP, x, y, 0)
              val accepted = try { preview.dispatchTouchEvent(down).also { preview.dispatchTouchEvent(up) } } finally { down.recycle(); up.recycle() }
              check(accepted) { "The Preview did not accept the touch event" }
            }
            "scroll" -> {
              val direction = command.getString("direction")
              check(direction == "up" || direction == "down") { "scroll requires up or down" }
              check(view.performAccessibilityAction(if (direction == "up") AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD else AccessibilityNodeInfo.ACTION_SCROLL_FORWARD, Bundle())) { "The native scroll action was not supported" }
            }
          }
          complete(result(JSONObject().put("performed", true).put("method", "native-view-event")))
        }
        else -> error("Unsupported Preview test command")
      }
    } catch (error: Exception) { complete(failure(error.message ?: "Preview testing failed")) }
  }

  private fun describe(view: View, preview: View): JSONObject {
    val info = view.createAccessibilityNodeInfo()
    val origin = IntArray(2).also(preview::getLocationOnScreen)
    val position = IntArray(2).also(view::getLocationOnScreen)
    val secure = info.isPassword
    val actions = JSONArray()
    if (info.isEnabled) {
      if (info.isClickable || view.isClickable) actions.put("press")
      if (view is EditText && !secure && view.inputType != InputType.TYPE_NULL) actions.put("fill")
      if (info.isScrollable) actions.put("scroll")
    }
    val rect = Rect()
    return JSONObject().put("role", info.className?.toString()?.substringAfterLast('.') ?: view.javaClass.simpleName)
      .put("text", if (secure) "" else info.text?.toString()?.take(512) ?: "")
      .put("label", info.contentDescription?.toString()?.take(512) ?: "")
      .put("testId", (view.getTag(com.facebook.react.R.id.react_test_id) as? String)?.take(256) ?: "")
      .put("bounds", JSONObject().put("x", position[0] - origin[0]).put("y", position[1] - origin[1]).put("width", view.width).put("height", view.height))
      .put("visible", view.isShown && view.alpha > 0 && view.getGlobalVisibleRect(rect))
      .put("enabled", info.isEnabled).put("selected", info.isSelected || info.isChecked).put("actions", actions)
  }

  companion object {
    private var active: WeakReference<NativePreviewActivity>? = null
    fun activate(activity: NativePreviewActivity) { active = WeakReference(activity) }
    fun deactivate(activity: NativePreviewActivity) { if (active?.get() === activity) active = null }
    fun activeActivity(): NativePreviewActivity? = active?.get()
    fun result(value: JSONObject): String = value.put("timestamp", System.currentTimeMillis()).toString()
    fun failure(message: String): String = result(JSONObject().put("error", message))
    private fun viewport(view: View): JSONObject = JSONObject().put("width", view.width).put("height", view.height).put("scale", 1)

    fun capture(activity: Activity, view: View, complete: (String) -> Unit) {
      if (Build.VERSION.SDK_INT < 26) { complete(failure("Preview pixel capture requires Android 8 or later")); return }
      if (!view.isShown || view.width <= 0 || view.height <= 0) { complete(failure("Preview is not visible")); return }
      val scale = min(1.0, 1280.0 / maxOf(view.width, view.height))
      val bitmap = Bitmap.createBitmap(maxOf(1, (view.width * scale).toInt()), maxOf(1, (view.height * scale).toInt()), Bitmap.Config.ARGB_8888)
      val position = IntArray(2).also(view::getLocationInWindow)
      val rect = Rect(position[0], position[1], position[0] + view.width, position[1] + view.height)
      PixelCopy.request(activity.window, rect, bitmap, { status ->
        try {
          check(status == PixelCopy.SUCCESS) { "Preview pixel capture failed ($status)" }
          val bytes = ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.JPEG, 70, it) }.toByteArray()
          check(bytes.size <= 340_000) { "Preview screenshot exceeds the image limit" }
          complete(result(JSONObject().put("viewport", viewport(view)).put("image", JSONObject()
            .put("mediaType", "image/jpeg").put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP)).put("width", bitmap.width).put("height", bitmap.height))))
        } catch (error: Exception) { complete(failure(error.message ?: "Preview screenshot failed")) }
        finally { bitmap.recycle() }
      }, Handler(Looper.getMainLooper()))
    }

    fun findWebView(root: View): WebView? {
      if (root is WebView) return root
      if (root is ViewGroup) for (index in 0 until root.childCount) findWebView(root.getChildAt(index))?.let { return it }
      return null
    }
  }
}

internal class NativePreviewConsolePackage(private val testing: NativePreviewTesting) : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(NativePreviewConsoleModule(context, testing))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

internal class NativePreviewConsoleModule(context: ReactApplicationContext, private val testing: NativePreviewTesting) : ReactContextBaseJavaModule(context) {
  override fun getName() = "RunWhalePreviewConsole"
  @ReactMethod fun log(level: String, message: String) { testing.log(level, message) }
}
