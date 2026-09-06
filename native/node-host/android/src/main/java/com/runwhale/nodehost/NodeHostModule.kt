package com.runwhale.nodehost

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.system.Os
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import kotlin.text.Charsets.UTF_8
import org.json.JSONObject

class NodeHostModule : Module() {
  private data class DownloadedNativePreviewBundle(
    val file: File,
    val sourceIdentifier: String,
  )

  private val nativePreviewRequestGate = NativePreviewRequestGate()
  private val nativePreviewMainHandler = Handler(Looper.getMainLooper())
  private val nativePreviewTimeouts = ConcurrentHashMap<String, Runnable>()
  private var testingBundleUrl: String? = null
  private var testingSourceId: String? = null

  private val nodeRuntime by lazy {
    val context = requireNotNull(appContext.reactContext) { "React context is unavailable" }
    NodeHostBootstrap.runtime(context).also { runtime -> runtime.setOnStateListener { snapshot ->
      sendEvent("onNodeState", snapshot.toMap() + ("timestamp" to System.currentTimeMillis()))
    } }
  }

  override fun definition() = ModuleDefinition {
    Name("RunWhaleNodeHost")
    Events("onNodeState", "onNodeLog", "onNativePreviewAction")

    OnCreate {
      NativePreviewActionCoordinator.setListener { action ->
        sendEvent("onNativePreviewAction", action.toMap())
      }
    }

    OnDestroy {
      NativePreviewActionCoordinator.setListener(null)
    }

    Function("snapshot") { nodeRuntime.snapshot().toMap() }
    AsyncFunction("testNativePreview") { projectId: String, bundleUrl: String, command: String, promise: Promise ->
      nativePreviewMainHandler.post {
        val activity = NativePreviewTesting.activeActivity()
        if (activity == null || activity.testing.projectId != projectId || bundleUrl != testingBundleUrl || activity.testing.sourceId != testingSourceId) {
          promise.resolve(NativePreviewTesting.failure("The requested Native Preview is not visible. Open the current revision."))
        } else {
          try { activity.testing.execute(activity, JSONObject(command)) { promise.resolve(it) } }
          catch (error: Exception) { promise.resolve(NativePreviewTesting.failure(error.message ?: "Invalid test command")) }
        }
      }
    }
    AsyncFunction("captureWebPreview") { viewTag: Int, promise: Promise ->
      nativePreviewMainHandler.post {
        val activity = appContext.currentActivity
        val root = activity?.findViewById<android.view.View>(viewTag)
        val webView = root?.let(NativePreviewTesting::findWebView)
        if (activity == null || webView == null) promise.resolve(NativePreviewTesting.failure("Web Preview is not mounted"))
        else NativePreviewTesting.capture(activity, webView) { promise.resolve(it) }
      }
    }
    AsyncFunction("closeNativePreview") { projectId: String, bundleUrl: String, promise: Promise ->
      nativePreviewMainHandler.post {
        val activity = NativePreviewTesting.activeActivity()
        if (bundleUrl != testingBundleUrl) promise.resolve(false)
        else if (activity == null) promise.resolve(true)
        else if (activity.testing.projectId != projectId || activity.testing.sourceId != testingSourceId) promise.resolve(false)
        else activity.closeForTesting { promise.resolve(it) }
      }
    }
    Function("runtimeRoot") { nodeRuntime.runtimeRoot() }
    Function("supportsProjectShortcuts") {
      appContext.reactContext?.let(ProjectShortcuts::supported) ?: false
    }
    AsyncFunction("pinProjectShortcut") { projectId: String, name: String, iconUri: String ->
      ProjectShortcuts.pin(requireNotNull(appContext.reactContext), projectId, name, iconUri)
    }
    Function("readHostInfo") { nodeRuntime.readHostInfo() }
    Function("takeNativePreviewDiagnostic") {
      val context = requireNotNull(appContext.reactContext) { "React context is unavailable" }
      val preferences = context.getSharedPreferences(NativePreviewActivity.DIAGNOSTIC_PREFERENCES, android.content.Context.MODE_PRIVATE)
      val message = preferences.getString(NativePreviewActivity.DIAGNOSTIC_KEY, null)
      if (message != null) preferences.edit().remove(NativePreviewActivity.DIAGNOSTIC_KEY).apply()
      message
    }
    Function("cancelNativePreviewOpen") { requestId: String ->
      if (REQUEST_ID_PATTERN.matches(requestId)) {
        NativePreviewLaunchCoordinator.cancel(requestId)
      } else {
        false
      }
    }
    AsyncFunction("start") { projectRoot: String, entry: String -> nodeRuntime.start(projectRoot, entry).toMap() }
    AsyncFunction("startBundled") { nodeRuntime.startBundled().toMap() }
    AsyncFunction("stop") { port: Int?, token: String? -> nodeRuntime.requestStop(port, token).toMap() }
    AsyncFunction("openNativePreview") { bundleUrl: String, requestId: String, projectId: String, promise: Promise ->
      if (!REQUEST_ID_PATTERN.matches(requestId)) {
        promise.reject("ERR_NATIVE_PREVIEW_REQUEST", "Native Preview request identifier is invalid", null)
        return@AsyncFunction
      }
      if (!NativePreviewProjectScope.PROJECT_ID_PATTERN.matches(projectId)) {
        promise.reject("ERR_NATIVE_PREVIEW_PROJECT", "Native Preview project identifier is invalid", null)
        return@AsyncFunction
      }
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("ERR_NATIVE_PREVIEW_CONTEXT", "React context is unavailable", null)
        return@AsyncFunction
      }
      if (!nativePreviewRequestGate.begin(requestId)) {
        promise.reject(
          "ERR_NATIVE_PREVIEW_IN_PROGRESS",
          "Another Native Preview launch is still in progress",
          null,
        )
        return@AsyncFunction
      }

      try {
        val registered = NativePreviewLaunchCoordinator.register(requestId) { result ->
          nativePreviewTimeouts.remove(requestId)?.let(nativePreviewMainHandler::removeCallbacks)
          nativePreviewRequestGate.finish(requestId)
          if (result.opened) {
            promise.resolve(mapOf("opened" to true))
          } else {
            val code = result.code ?: "launch_failed"
            val message = result.message ?: "Native Preview failed before its first content draw"
            promise.reject("ERR_NATIVE_PREVIEW_${code.uppercase()}", message, null)
          }
        }
        if (!registered) return@AsyncFunction
      } catch (error: Throwable) {
        nativePreviewRequestGate.finish(requestId)
        promise.reject("ERR_NATIVE_PREVIEW_REQUEST", error.message ?: "Native Preview request is invalid", null)
        return@AsyncFunction
      }

      NativePreviewDiagnostics.clear(context)
      val bundle = try {
        downloadNativePreviewBundle(context, bundleUrl, requestId)
      } catch (error: Throwable) {
        if (!NativePreviewLaunchCoordinator.isPending(requestId)) return@AsyncFunction
        val message = NativePreviewDiagnostics.record(
          context,
          stage = "download",
          code = "bundle_download_failed",
          rawMessage = error.message,
          fallbackMessage = "Native Preview could not download the Metro bundle",
        )
        NativePreviewLaunchCoordinator.complete(
          requestId,
          NativePreviewLaunchResult(
            opened = false,
            code = "bundle_download_failed",
            message = message,
          ),
        )
        return@AsyncFunction
      }
      if (!NativePreviewLaunchCoordinator.isPending(requestId)) {
        bundle.file.delete()
        return@AsyncFunction
      }
      testingBundleUrl = bundleUrl
      testingSourceId = bundle.sourceIdentifier
      val activity = appContext.currentActivity
      if (activity == null) {
        bundle.file.delete()
        val message = NativePreviewDiagnostics.record(
          context,
          stage = "launch",
          code = "activity_unavailable",
          rawMessage = null,
          fallbackMessage = "Current Activity is unavailable",
        )
        NativePreviewLaunchCoordinator.complete(
          requestId,
          NativePreviewLaunchResult(
            opened = false,
            code = "activity_unavailable",
            message = message,
          ),
        )
        return@AsyncFunction
      }
      try {
        launchNativePreview(activity, context, bundle, requestId, projectId)
      } catch (error: Throwable) {
        bundle.file.delete()
        if (!NativePreviewLaunchCoordinator.isPending(requestId)) return@AsyncFunction
        val message = NativePreviewDiagnostics.record(
          context,
          stage = "launch",
          code = "activity_launch_failed",
          rawMessage = error.message,
          fallbackMessage = "Native Preview Activity could not be opened",
        )
        NativePreviewLaunchCoordinator.complete(
          requestId,
          NativePreviewLaunchResult(
            opened = false,
            code = "activity_launch_failed",
            message = message,
          ),
        )
      }
    }
  }

  private fun downloadNativePreviewBundle(
    context: Context,
    bundleUrl: String,
    requestId: String,
  ): DownloadedNativePreviewBundle {
    val uri = URI(bundleUrl)
    require(
      uri.scheme == "http" &&
        uri.host == "127.0.0.1" &&
        uri.port in 1..65535 &&
        uri.rawUserInfo == null &&
        uri.rawFragment == null &&
        TOKEN_QUERY_PATTERN.containsMatchIn(uri.rawQuery.orEmpty()),
    ) {
      "Native Preview only accepts a token-protected localhost bundle"
    }

    val requestKey = MessageDigest.getInstance("SHA-256")
      .digest(requestId.toByteArray(UTF_8))
      .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
    val bundle = File(
      context.cacheDir,
      "${NativePreviewActivity.BUNDLE_FILE_PREFIX}$requestKey${NativePreviewActivity.BUNDLE_FILE_SUFFIX}",
    )
    val temporary = File(context.cacheDir, "${bundle.name}.tmp")
    if (temporary.exists()) require(temporary.delete()) {
      "Unable to prepare the Native Preview bundle cache"
    }
    val digest = MessageDigest.getInstance("SHA-256")
    // A fresh preview.run receives a fresh unguessable URL token and must
    // reload even when its emitted JavaScript is byte-for-byte identical.
    // Only this one-way identifier crosses into the Preview Activity.
    digest.update(bundleUrl.toByteArray(UTF_8))
    digest.update(0.toByte())
    val connection = URL(bundleUrl).openConnection() as HttpURLConnection
    connection.connectTimeout = 5_000
    connection.readTimeout = 30_000
    connection.instanceFollowRedirects = false
    try {
      require(connection.responseCode == HttpURLConnection.HTTP_OK) {
        "Metro returned HTTP ${connection.responseCode}"
      }
      val declared = connection.contentLengthLong
      require(declared == -1L || declared <= MAX_PREVIEW_BYTES) {
        "Native Preview bundle exceeds the 48 MiB limit"
      }
      var total = 0L
      connection.inputStream.use { input ->
        temporary.outputStream().use { output ->
          val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
          while (true) {
            check(NativePreviewLaunchCoordinator.isPending(requestId)) {
              "Native Preview launch was cancelled"
            }
            val count = input.read(buffer)
            if (count < 0) break
            total += count
            require(total <= MAX_PREVIEW_BYTES) {
              "Native Preview bundle exceeds the 48 MiB limit"
            }
            digest.update(buffer, 0, count)
            output.write(buffer, 0, count)
          }
        }
      }
      require(total > 0) { "Metro returned an empty Native Preview bundle" }
      check(NativePreviewLaunchCoordinator.isPending(requestId)) {
        "Native Preview launch was cancelled"
      }
      Os.rename(temporary.absolutePath, bundle.absolutePath)
      return DownloadedNativePreviewBundle(
        file = bundle,
        sourceIdentifier = digest.digest().joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) },
      )
    } finally {
      connection.disconnect()
      if (temporary.isFile) temporary.delete()
    }
  }

  private fun launchNativePreview(
    activity: Activity,
    context: Context,
    bundle: DownloadedNativePreviewBundle,
    requestId: String,
    projectId: String,
  ) {
    val timeout = Runnable {
      if (!NativePreviewLaunchCoordinator.isPending(requestId)) return@Runnable
      val message = NativePreviewDiagnostics.record(
        context,
        stage = "launch",
        code = "activity_result_timeout",
        rawMessage = null,
        fallbackMessage = "Native Preview did not report its first content draw",
      )
      NativePreviewLaunchCoordinator.complete(
        requestId,
        NativePreviewLaunchResult(
          opened = false,
          code = "activity_result_timeout",
          message = message,
        ),
      )
    }

    nativePreviewTimeouts[requestId] = timeout
    nativePreviewMainHandler.postDelayed(timeout, ACTIVITY_RESULT_TIMEOUT_MS)
    if (!NativePreviewLaunchCoordinator.isPending(requestId)) {
      nativePreviewTimeouts.remove(requestId, timeout)
      nativePreviewMainHandler.removeCallbacks(timeout)
      bundle.file.delete()
      return
    }
    nativePreviewMainHandler.post {
      if (!NativePreviewLaunchCoordinator.isPending(requestId)) {
        bundle.file.delete()
        return@post
      }
      try {
        require(!activity.isFinishing && !activity.isDestroyed) {
          "Current Activity is unavailable"
        }
        activity.startActivity(Intent(activity, NativePreviewActivity::class.java).apply {
          addFlags(NativePreviewTaskLifecycle.LAUNCH_FLAGS)
          putExtra(
            NativePreviewActivity.EXTRA_BUNDLE_PATH,
            bundle.file.absolutePath,
          )
          putExtra(NativePreviewActivity.EXTRA_SOURCE_ID, bundle.sourceIdentifier)
          putExtra(NativePreviewActivity.EXTRA_REQUEST_ID, requestId)
          putExtra(NativePreviewActivity.EXTRA_PROJECT_ID, projectId)
        })
      } catch (error: Throwable) {
        bundle.file.delete()
        if (!NativePreviewLaunchCoordinator.isPending(requestId)) return@post
        val message = NativePreviewDiagnostics.record(
          context,
          stage = "launch",
          code = "activity_launch_failed",
          rawMessage = error.message,
          fallbackMessage = "Native Preview Activity could not be opened",
        )
        NativePreviewLaunchCoordinator.complete(
          requestId,
          NativePreviewLaunchResult(
            opened = false,
            code = "activity_launch_failed",
            message = message,
          ),
        )
      }
    }
  }

  private fun NodeRuntime.Snapshot.toMap(): Map<String, Any?> = mapOf(
    "state" to state,
    "nodeVersion" to nodeVersion,
    "lastError" to lastError,
  )

  private companion object {
    const val MAX_PREVIEW_BYTES = 48L * 1024L * 1024L
    const val ACTIVITY_RESULT_TIMEOUT_MS = 25_000L
    val TOKEN_QUERY_PATTERN = Regex("(?:^|&)token=[A-Za-z0-9_-]{32,}(?:&|$)")
    val REQUEST_ID_PATTERN = Regex("[A-Za-z0-9._:-]{8,128}")
  }
}
