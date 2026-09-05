package com.runwhale.nodehost

import android.content.Context
import android.content.pm.ApplicationInfo
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

internal class NodeRuntime(private val context: Context) {
  data class Snapshot(val state: String, val nodeVersion: String? = null, val lastError: String? = null)

  private val executor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "RunWhaleNode-24.19").apply { isDaemon = true }
  }
  private val snapshot = AtomicReference(Snapshot("stopped"))
  private val startGate = NodeRuntimeStartGate()
  @Volatile private var onState: ((Snapshot) -> Unit)? = null

  external fun startNode(arguments: Array<String>, workingDirectory: String): Int

  fun snapshot(): Snapshot = snapshot.get()

  fun setOnStateListener(listener: ((Snapshot) -> Unit)?) {
    onState = listener
    listener?.invoke(snapshot.get())
  }

  @Synchronized
  fun start(projectRoot: String, entry: String): Snapshot {
    val current = snapshot.get()
    if (current.state == "starting" || current.state == "running") return current
    if (!startGate.claim()) {
      val failed = Snapshot("failed", "24.19.0", NODE_RELAUNCH_REQUIRED)
      publish(failed)
      return failed
    }
    publish(Snapshot("starting", "24.19.0"))
    executor.execute {
      publish(Snapshot("running", "24.19.0"))
      val result = try {
        startNode(arrayOf("node", entry, projectRoot, File(projectRoot, "node_modules").absolutePath), projectRoot)
      } catch (error: Throwable) {
        publish(Snapshot("failed", "24.19.0", error.message ?: error.javaClass.simpleName))
        return@execute
      }
      val detail = if (result == 0) NODE_RELAUNCH_REQUIRED
      else "Node exited with code $result. $NODE_RELAUNCH_REQUIRED"
      publish(Snapshot("failed", "24.19.0", detail))
    }
    return snapshot.get()
  }

  @Synchronized
  fun startBundled(): Snapshot {
    val current = snapshot.get()
    if (current.state != "stopped") return current
    val root = File(context.filesDir, "runwhale-runtime").apply { mkdirs() }
    val metadata = File(root, ".runwhale").apply { mkdirs() }
    File(metadata, "host.json").delete()
    File(root, "node_modules").mkdirs()
    val bundledAssets = listOf(
      "runwhale-runtime.mjs",
      "runwhale-agent-runtime.mjs",
      "runwhale-task-worker.mjs",
      "runwhale-package-worker.mjs",
      "worker.cjs",
      "runwhale-module-store.tgz",
      "runwhale-npm.tgz",
    )
    val bundleVersion = context.packageManager
      .getPackageInfo(context.packageName, 0)
      .lastUpdateTime
      .toString()
    val bundleVersionFile = File(root, ".runwhale-bundle-version")
    val bundledAssetsReady = bundleVersionFile.takeIf { it.isFile }?.readText() == bundleVersion &&
      bundledAssets.all { File(root, it).isFile }
    if (!bundledAssetsReady) {
      bundledAssets.forEach { copyAssetAtomically(it, File(root, it)) }
      val temporaryVersion = File(root, ".runwhale-bundle-version.tmp")
      temporaryVersion.writeText(bundleVersion)
      if (bundleVersionFile.exists() && !bundleVersionFile.delete()) error("Unable to replace bundled runtime version")
      if (!temporaryVersion.renameTo(bundleVersionFile)) error("Unable to publish bundled runtime version")
    }
    val entry = File(root, "runwhale-runtime.mjs")
    return start(root.absolutePath, entry.absolutePath)
  }

  fun runtimeRoot(): String = File(context.filesDir, "runwhale-runtime").absolutePath

  fun readHostInfo(): String? = runCatching {
    File(runtimeRoot(), ".runwhale/host.json").takeIf { it.isFile }?.readText()
  }.getOrNull()

  fun requestStop(port: Int?, token: String?): Snapshot {
    val current = snapshot.get()
    if (current.state != "running" || port == null || token.isNullOrBlank()) return current
    publish(current.copy(state = "stopping"))
    Thread({
      runCatching {
        val connection = URL("http://127.0.0.1:$port/__runwhale/stop").openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.setRequestProperty("Authorization", "Bearer $token")
        connection.connectTimeout = 1_000
        connection.readTimeout = 1_000
        connection.responseCode
        connection.disconnect()
      }.onFailure { publish(Snapshot("failed", current.nodeVersion, it.message)) }
    }, "RunWhaleNode-stop").apply { isDaemon = true }.start()
    return snapshot.get()
  }

  private fun publish(value: Snapshot) {
    snapshot.set(value)
    onState?.invoke(value)
  }

  private fun copyAssetAtomically(assetName: String, destination: File) {
    val temporary = File(destination.parentFile, "${destination.name}.tmp")
    context.assets.open(assetName).use { input ->
      temporary.outputStream().use { output -> input.copyTo(output) }
    }
    if (destination.exists() && !destination.delete()) error("Unable to replace bundled asset $assetName")
    if (!temporary.renameTo(destination)) error("Unable to install bundled asset $assetName")
  }

  companion object {
    private const val NODE_RELAUNCH_REQUIRED =
      "Embedded Node stopped and cannot restart inside the current app process. Fully close and reopen RunWhale."

    init { System.loadLibrary("runwhale-node-host") }
  }
}

internal class NodeRuntimeStartGate {
  private var claimed = false

  @Synchronized
  fun claim(): Boolean {
    if (claimed) return false
    claimed = true
    return true
  }
}

/** Starts the process-wide embedded runtime before React Native downloads its Studio bundle. */
object NodeHostBootstrap {
  @Volatile private var instance: NodeRuntime? = null

  internal fun runtime(context: Context): NodeRuntime = instance ?: synchronized(this) {
    instance ?: NodeRuntime(context.applicationContext).also { instance = it }
  }

  @JvmStatic
  fun startBundled(context: Context) {
    configureDebugMetroHost(context)
    Thread({ runtime(context).startBundled() }, "RunWhaleNode-bootstrap").apply {
      isDaemon = true
      start()
    }
  }

  private fun configureDebugMetroHost(context: Context) {
    if (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE == 0) return

    val preferences = context.getSharedPreferences(
      "${context.packageName}_preferences",
      Context.MODE_PRIVATE,
    )
    if (!preferences.contains("debug_http_host")) {
      preferences.edit().putString("debug_http_host", "localhost:8081").apply()
    }
  }
}
