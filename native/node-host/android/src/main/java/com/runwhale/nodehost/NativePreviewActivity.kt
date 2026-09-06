package com.runwhale.nodehost

import android.content.Intent
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewConfiguration
import android.view.ViewTreeObserver
import android.view.WindowInsets
import android.widget.FrameLayout
import android.widget.ImageButton
import androidx.appcompat.app.AppCompatActivity
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.bridge.JSBundleLoader
import com.facebook.react.common.annotations.FrameworkAPI
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.defaults.DefaultComponentsRegistry
import com.facebook.react.defaults.DefaultReactHostDelegate
import com.facebook.react.defaults.DefaultTurboModuleManagerDelegate
import com.facebook.react.fabric.ComponentFactory
import com.facebook.react.interfaces.fabric.ReactSurface
import com.facebook.react.modules.core.DefaultHardwareBackBtnHandler
import com.facebook.react.runtime.ReactHostImpl
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.max

@OptIn(UnstableReactNativeAPI::class, FrameworkAPI::class)
class NativePreviewActivity : AppCompatActivity(), DefaultHardwareBackBtnHandler {
  internal val testing = NativePreviewTesting()
  private data class SafeWindowInsets(val top: Int, val right: Int, val bottom: Int, val left: Int)

  private val mainHandler = Handler(Looper.getMainLooper())
  private val startExecutor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "RunWhaleNativePreviewStart").apply { isDaemon = true }
  }
  private val pendingRequestIds = linkedSetOf<String>()

  private var host: ReactHost? = null
  private var surface: ReactSurface? = null
  private var previewView: ViewGroup? = null
  private var previewRoot: FrameLayout? = null
  private var previewControl: ImageButton? = null
  private var safeWindowInsets = SafeWindowInsets(0, 0, 0, 0)
  private var firstDrawListener: ViewTreeObserver.OnDrawListener? = null
  private var readinessTimeout: Runnable? = null
  private var cancellationSubscription: NativePreviewCancellationSubscription? = null
  private var bundleFile: File? = null
  private var sourceIdentifier: String? = null
  private var projectIdentifier: String? = null
  private var surfaceStarted = false
  private var firstContentDrawn = false
  private var contentReady = false
  private var startupFailed = false
  private var crashed = false
  private var recreatingForNewSource = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    cancellationSubscription = NativePreviewLaunchCoordinator.addCancellationListener { requestId ->
      runOnUiThread { cancelLaunchRequest(requestId) }
    }
    val initialRequestId = intent.getStringExtra(EXTRA_REQUEST_ID)
    val restoringReadyPreview = savedInstanceState?.getBoolean(STATE_CONTENT_READY) == true
    if (!restoringReadyPreview && (
        initialRequestId.isNullOrBlank() ||
          !NativePreviewLaunchCoordinator.isPending(initialRequestId)
      )) {
      runCatching { requireNativePreviewBundle(intent) }.getOrNull()?.delete()
      finish()
      return
    }
    configureEdgeToEdgeWindow()
    restoreLaunchRequests(savedInstanceState)

    val root = FrameLayout(this).apply {
      setBackgroundColor(Color.rgb(7, 24, 42))
    }
    previewRoot = root
    setContentView(root)
    installMinimizeControl(root)

    try {
      val sourceId = requireNotNull(intent.getStringExtra(EXTRA_SOURCE_ID)) {
        "Native Preview source identifier is unavailable"
      }
      require(SOURCE_ID_PATTERN.matches(sourceId)) {
        "Native Preview source identifier is invalid"
      }
      val projectId = requireNativePreviewProjectId(intent, savedInstanceState)
      val expectedBundle = requireNativePreviewBundle(intent)
      bundleFile = expectedBundle
      sourceIdentifier = sourceId
      projectIdentifier = projectId
      testing.projectId = projectId
      testing.sourceId = sourceId
      startPreview(root, expectedBundle.absolutePath, projectId)
    } catch (error: Throwable) {
      failStartup(
        stage = "host-create",
        code = "host_create_failed",
        rawMessage = error.message,
        fallbackMessage = "Native Preview could not create its isolated React host",
      )
    }
  }

  private fun startPreview(root: FrameLayout, bundlePath: String, projectId: String) {
    val componentFactory = ComponentFactory().also(DefaultComponentsRegistry::register)
    val delegate = DefaultReactHostDelegate(
      jsMainModulePath = "index",
      jsBundleLoader = JSBundleLoader.createFileLoader(bundlePath, PREVIEW_SCRIPT_URL, false),
      reactPackages = NativePreviewReactPackages.create(application, projectId) + NativePreviewConsolePackage(testing),
      turboModuleManagerDelegateBuilder = DefaultTurboModuleManagerDelegate.Builder(),
      exceptionHandler = { error ->
        runOnUiThread { handleRuntimeFailure(error.message) }
      },
    )
    val previewHost = ReactHostImpl(
      applicationContext,
      delegate,
      componentFactory,
      allowPackagerServerAccess = false,
      useDevSupport = false,
    )
    val previewSurface = previewHost.createSurface(this, "main", null)
    val preview = requireNotNull(previewSurface.view) {
      "React Native did not create a Preview surface"
    }
    host = previewHost
    surface = previewSurface
    previewView = preview
    testing.root = preview
    root.addView(
      preview,
      0,
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      ),
    )

    observeFirstContentDraw(preview)
    scheduleReadinessTimeout()

    // The Preview host receives only the v1 ABI allowlist. FileSystem and the
    // storage compatibility module are scoped to this validated project id;
    // the global app modules, Node Host, SecureStore, and Studio stay absent.
    val startTask = previewSurface.start()
    startExecutor.execute {
      try {
        if (!startTask.waitForCompletion(SURFACE_START_TIMEOUT_MS, TimeUnit.MILLISECONDS) || !startTask.isCompleted()) {
          runOnUiThread {
            failStartup(
              stage = "surface-start",
              code = "surface_start_timeout",
              rawMessage = null,
              fallbackMessage = "Native Preview timed out while starting React Native",
            )
          }
          return@execute
        }
        val error = startTask.getError()
        runOnUiThread {
          when {
            startTask.isCancelled() -> failStartup(
              stage = "surface-start",
              code = "surface_start_cancelled",
              rawMessage = null,
              fallbackMessage = "React Native cancelled the Native Preview surface",
            )
            error != null -> failStartup(
              stage = "surface-start",
              code = "surface_start_failed",
              rawMessage = error.message,
              fallbackMessage = "React Native failed to start the Native Preview surface",
            )
            else -> {
              surfaceStarted = true
              completeIfReady()
            }
          }
        }
      } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
        runOnUiThread {
          if (!isDestroyed) {
            failStartup(
              stage = "surface-start",
              code = "surface_start_interrupted",
              rawMessage = null,
              fallbackMessage = "Native Preview startup was interrupted",
            )
          }
        }
      }
    }
  }

  private fun observeFirstContentDraw(preview: ViewGroup) {
    val listener = object : ViewTreeObserver.OnDrawListener {
      override fun onDraw() {
        if (firstContentDrawn || preview.width <= 0 || preview.height <= 0 || preview.childCount == 0) return
        firstContentDrawn = true
        preview.post {
          removeFirstDrawObserver()
          completeIfReady()
        }
      }
    }
    firstDrawListener = listener
    preview.viewTreeObserver.addOnDrawListener(listener)
  }

  private fun scheduleReadinessTimeout() {
    val timeout = Runnable {
      if (contentReady || startupFailed || crashed) return@Runnable
      failStartup(
        stage = if (surfaceStarted) "content-mount" else "surface-start",
        code = if (surfaceStarted) "content_mount_timeout" else "surface_start_timeout",
        rawMessage = null,
        fallbackMessage = if (surfaceStarted) {
          "Native Preview started React Native but no content was drawn"
        } else {
          "Native Preview timed out while starting React Native"
        },
      )
    }
    readinessTimeout = timeout
    mainHandler.postDelayed(timeout, CONTENT_READY_TIMEOUT_MS)
  }

  private fun completeIfReady() {
    if (contentReady || startupFailed || crashed || !surfaceStarted || !firstContentDrawn) return
    contentReady = true
    cancelReadinessObservers()
    completePendingRequests(NativePreviewLaunchResult(opened = true))
  }

  private fun failStartup(
    stage: String,
    code: String,
    rawMessage: String?,
    fallbackMessage: String,
    returnToStudio: Boolean = true,
  ) {
    if (contentReady || startupFailed) return
    startupFailed = true
    cancelReadinessObservers()
    val message = NativePreviewDiagnostics.record(this, stage, code, rawMessage, fallbackMessage)
    completePendingRequests(
      NativePreviewLaunchResult(opened = false, code = code, message = message),
    )
    if (returnToStudio) scheduleReturnToStudio()
  }

  private fun handleRuntimeFailure(rawMessage: String?) {
    if (crashed) return
    val failedAfterReady = contentReady
    crashed = true
    cancelReadinessObservers()
    val message = NativePreviewDiagnostics.record(
      this,
      stage = "runtime",
      code = "runtime_exception",
      rawMessage = rawMessage,
      fallbackMessage = "Native Preview encountered a fatal JavaScript error",
    )
    if (!contentReady && !startupFailed) {
      startupFailed = true
      completePendingRequests(
        NativePreviewLaunchResult(
          opened = false,
          code = "runtime_exception",
          message = message,
        ),
      )
    } else if (failedAfterReady) {
      NativePreviewActionCoordinator.emitFailure(message)
    }
    scheduleReturnToStudio()
  }

  private fun completePendingRequests(result: NativePreviewLaunchResult) {
    val requestIds = pendingRequestIds.toList()
    pendingRequestIds.clear()
    requestIds.forEach { requestId -> NativePreviewLaunchCoordinator.complete(requestId, result) }
  }

  private fun cancelLaunchRequest(requestId: String) {
    if (!shouldFinishNativePreviewAfterCancellation(pendingRequestIds, requestId)) return
    startupFailed = true
    cancelReadinessObservers()
    finish()
  }

  private fun cancelReadinessObservers() {
    readinessTimeout?.let(mainHandler::removeCallbacks)
    readinessTimeout = null
    removeFirstDrawObserver()
  }

  private fun removeFirstDrawObserver() {
    val listener = firstDrawListener ?: return
    firstDrawListener = null
    val observer = previewView?.viewTreeObserver ?: return
    if (observer.isAlive) observer.removeOnDrawListener(listener)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    val requestId = intent.getStringExtra(EXTRA_REQUEST_ID)
    val nextSource = intent.getStringExtra(EXTRA_SOURCE_ID)
    val nextProject = intent.getStringExtra(EXTRA_PROJECT_ID)
    val nextBundle = try {
      requireNativePreviewBundle(intent)
    } catch (_: Throwable) {
      null
    }
    if (
      requestId.isNullOrBlank() ||
        !NativePreviewLaunchCoordinator.isPending(requestId) ||
        nextSource == null ||
        !SOURCE_ID_PATTERN.matches(nextSource) ||
        nextProject == null ||
        !NativePreviewProjectScope.PROJECT_ID_PATTERN.matches(nextProject) ||
        nextBundle == null
    ) {
      nextBundle?.delete()
      requestId?.let {
        NativePreviewLaunchCoordinator.complete(
          it,
          NativePreviewLaunchResult(
            opened = false,
            code = "invalid_launch_request",
            message = "Native Preview launch request is invalid",
          ),
        )
      }
      return
    }

    if (
      isSameNativePreviewHostIdentity(sourceIdentifier, projectIdentifier, nextSource, nextProject) &&
        contentReady &&
        !crashed
    ) {
      resetPreviewControlPosition()
      discardUnusedBundle(nextBundle)
      intent.putExtra(EXTRA_BUNDLE_PATH, requireNotNull(bundleFile).absolutePath)
      setIntent(intent)
      NativePreviewLaunchCoordinator.complete(requestId, NativePreviewLaunchResult(opened = true))
      return
    }
    if (
      isSameNativePreviewHostIdentity(sourceIdentifier, projectIdentifier, nextSource, nextProject) &&
        !startupFailed &&
        !crashed
    ) {
      resetPreviewControlPosition()
      discardUnusedBundle(nextBundle)
      intent.putExtra(EXTRA_BUNDLE_PATH, requireNotNull(bundleFile).absolutePath)
      setIntent(intent)
      pendingRequestIds.add(requestId)
      return
    }

    if (pendingRequestIds.isNotEmpty()) {
      val message = NativePreviewDiagnostics.record(
        this,
        stage = "launch",
        code = "launch_superseded",
        rawMessage = null,
        fallbackMessage = "Native Preview startup was replaced by a newer bundle",
      )
      completePendingRequests(
        NativePreviewLaunchResult(
          opened = false,
          code = "launch_superseded",
          message = message,
        ),
      )
    }
    pendingRequestIds.add(requestId)
    recreatingForNewSource = true
    setIntent(intent)
    recreate()
  }

  override fun onSaveInstanceState(outState: Bundle) {
    outState.putStringArrayList(STATE_PENDING_REQUESTS, ArrayList(pendingRequestIds))
    outState.putBoolean(STATE_CONTENT_READY, contentReady && !recreatingForNewSource)
    outState.putString(
      STATE_PROJECT_ID,
      intent.getStringExtra(EXTRA_PROJECT_ID) ?: projectIdentifier,
    )
    super.onSaveInstanceState(outState)
  }

  private fun restoreLaunchRequests(savedInstanceState: Bundle?) {
    savedInstanceState?.getStringArrayList(STATE_PENDING_REQUESTS)?.forEach { requestId ->
      if (requestId.isNotBlank()) pendingRequestIds.add(requestId)
    }
    intent.getStringExtra(EXTRA_REQUEST_ID)?.takeIf { it.isNotBlank() }?.let(pendingRequestIds::add)
  }

  override fun onResume() {
    super.onResume()
    // Studio owns Agent RPC and test dispatch. Its host must keep processing
    // events and timers while this in-app Preview is the foreground activity.
    (application as ReactApplication).reactHost?.onHostResume(this, this)
    NativePreviewTesting.activate(this)
    host?.onHostResume(this, this)
  }

  override fun onPause() {
    NativePreviewTesting.deactivate(this)
    host?.onHostPause(this)
    (application as ReactApplication).reactHost?.onHostPause(this)
    super.onPause()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    host?.onWindowFocusChange(hasFocus)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    host?.onConfigurationChanged(this)
  }

  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    host?.onActivityResult(this, requestCode, resultCode, data)
  }

  @Deprecated("Android dispatches Preview back presses through React Native first")
  override fun onBackPressed() {
    if (host?.onBackPressed() != true) minimizeToStudio()
  }

  override fun invokeDefaultOnBackPressed() {
    // React Native invokes this only after JavaScript declines the back event.
    // Calling host.onBackPressed() here would emit the same event recursively.
    minimizeToStudio()
  }

  override fun onDestroy() {
    if (!recreatingForNewSource && !isChangingConfigurations && pendingRequestIds.isNotEmpty()) {
      val message = NativePreviewDiagnostics.record(
        this,
        stage = "lifecycle",
        code = "activity_destroyed",
        rawMessage = null,
        fallbackMessage = "Native Preview closed before its first content draw",
      )
      completePendingRequests(
        NativePreviewLaunchResult(
          opened = false,
          code = "activity_destroyed",
          message = message,
        ),
      )
    }
    cancelReadinessObservers()
    cancellationSubscription?.remove()
    cancellationSubscription = null
    mainHandler.removeCallbacksAndMessages(null)
    startExecutor.shutdownNow()
    surface?.stop()
    surface?.detach()
    surface = null
    previewView = null
    host?.onHostDestroy(this)
    host?.invalidate()
    host = null
    if (recreatingForNewSource || !isChangingConfigurations) bundleFile?.delete()
    bundleFile = null
    projectIdentifier = null
    super.onDestroy()
  }

  private fun requireNativePreviewProjectId(
    sourceIntent: Intent,
    savedInstanceState: Bundle?,
  ): String {
    val projectId = requireNotNull(sourceIntent.getStringExtra(EXTRA_PROJECT_ID)) {
      "Native Preview project identifier is unavailable"
    }
    require(NativePreviewProjectScope.PROJECT_ID_PATTERN.matches(projectId)) {
      "Native Preview project identifier is invalid"
    }
    val savedProjectId = savedInstanceState?.getString(STATE_PROJECT_ID)
    require(savedProjectId == null || savedProjectId == projectId) {
      "Native Preview project identifier changed during restoration"
    }
    return projectId
  }

  private fun requireNativePreviewBundle(sourceIntent: Intent): File {
    val bundlePath = requireNotNull(sourceIntent.getStringExtra(EXTRA_BUNDLE_PATH)) {
      "Native Preview bundle is unavailable"
    }
    val candidate = File(bundlePath).canonicalFile
    val expectedParent = cacheDir.canonicalFile
    require(
      candidate.parentFile == expectedParent &&
        PREVIEW_BUNDLE_NAME_PATTERN.matches(candidate.name) &&
        candidate.isFile,
    ) {
      "Native Preview bundle is unavailable"
    }
    return candidate
  }

  private fun discardUnusedBundle(candidate: File) {
    if (candidate != bundleFile) candidate.delete()
  }

  private fun installMinimizeControl(root: FrameLayout) {
    val chinese = resources.configuration.locales.get(0)?.language == "zh"
    val close = previewControl(
      drawable = R.drawable.runwhale_close,
      label = if (chinese) "关闭 Preview" else "Close Preview",
      onClick = ::minimizeToStudio,
    )
    previewControl = close
    val layoutParams = FrameLayout.LayoutParams(
      dp(48),
      dp(48),
      Gravity.TOP or Gravity.END,
    ).apply {
      topMargin = dp(8)
      marginEnd = dp(8)
    }
    root.addView(close, layoutParams)
    root.setOnApplyWindowInsetsListener { _, windowInsets ->
      safeWindowInsets = safeInsets(windowInsets)
      clampPreviewControlPosition()
      windowInsets
    }
    root.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> clampPreviewControlPosition() }
    root.requestApplyInsets()
  }

  private fun previewControl(drawable: Int, label: String, onClick: () -> Unit) =
    ImageButton(this).apply {
      val accent = previewThemeAccent()
      contentDescription = label
      setImageResource(drawable)
      imageTintList = ColorStateList.valueOf(accent)
      setPadding(dp(14), dp(14), dp(14), dp(14))
      background = RippleDrawable(
        ColorStateList.valueOf(Color.argb(80, Color.red(accent), Color.green(accent), Color.blue(accent))),
        GradientDrawable().apply {
          shape = GradientDrawable.OVAL
          setColor(Color.argb(184, 7, 24, 42))
        },
        null,
      )
      elevation = 0f
      stateListAnimator = null
      isFocusable = true
      setOnClickListener { onClick() }
      this@NativePreviewActivity.installPreviewControlDrag(this)
    }

  private fun installPreviewControlDrag(control: ImageButton) {
    val touchSlop = ViewConfiguration.get(this).scaledTouchSlop
    control.setOnTouchListener(object : View.OnTouchListener {
      private var downX = 0f
      private var downY = 0f
      private var startTop = 0
      private var startEnd = 0
      private var dragging = false

      override fun onTouch(view: View, event: MotionEvent): Boolean {
        when (event.actionMasked) {
          MotionEvent.ACTION_DOWN -> {
            val current = control.layoutParams as FrameLayout.LayoutParams
            downX = event.rawX
            downY = event.rawY
            startTop = current.topMargin
            startEnd = current.marginEnd
            dragging = false
            view.isPressed = true
          }
          MotionEvent.ACTION_MOVE -> {
            val dx = event.rawX - downX
            val dy = event.rawY - downY
            if (!dragging && (abs(dx) >= touchSlop || abs(dy) >= touchSlop)) {
              dragging = true
              view.isPressed = false
            }
            if (dragging) {
              val current = control.layoutParams as FrameLayout.LayoutParams
              current.topMargin = startTop + dy.toInt()
              current.marginEnd = startEnd - dx.toInt()
              control.layoutParams = current
              clampPreviewControlPosition()
            }
          }
          MotionEvent.ACTION_UP -> {
            view.isPressed = false
            if (!dragging) view.performClick()
          }
          MotionEvent.ACTION_CANCEL -> view.isPressed = false
        }
        return true
      }
    })
  }

  private fun resetPreviewControlPosition() {
    val control = previewControl ?: return
    val current = control.layoutParams as FrameLayout.LayoutParams
    current.topMargin = safeWindowInsets.top + dp(8)
    current.marginEnd = safeWindowInsets.right + dp(8)
    control.layoutParams = current
  }

  private fun clampPreviewControlPosition() {
    val root = previewRoot ?: return
    val control = previewControl ?: return
    val minimumTop = safeWindowInsets.top + dp(8)
    val minimumEnd = safeWindowInsets.right + dp(8)
    val maximumTop = max(minimumTop, root.height - safeWindowInsets.bottom - dp(56))
    val maximumEnd = max(minimumEnd, root.width - safeWindowInsets.left - dp(56))
    val current = control.layoutParams as FrameLayout.LayoutParams
    current.topMargin = current.topMargin.coerceIn(minimumTop, maximumTop)
    current.marginEnd = current.marginEnd.coerceIn(minimumEnd, maximumEnd)
    control.layoutParams = current
  }

  private fun safeInsets(windowInsets: WindowInsets): SafeWindowInsets =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val insets = windowInsets.getInsets(
        WindowInsets.Type.systemBars() or
          WindowInsets.Type.displayCutout() or
          WindowInsets.Type.systemGestures(),
      )
      SafeWindowInsets(top = insets.top, right = insets.right, bottom = insets.bottom, left = insets.left)
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      @Suppress("DEPRECATION")
      val gestureInsets = windowInsets.systemGestureInsets
      @Suppress("DEPRECATION")
      SafeWindowInsets(
        top = max(windowInsets.systemWindowInsetTop, gestureInsets.top),
        right = max(windowInsets.systemWindowInsetRight, gestureInsets.right),
        bottom = max(windowInsets.systemWindowInsetBottom, gestureInsets.bottom),
        left = max(windowInsets.systemWindowInsetLeft, gestureInsets.left),
      )
    } else {
      @Suppress("DEPRECATION")
      SafeWindowInsets(
        top = windowInsets.systemWindowInsetTop,
        right = windowInsets.systemWindowInsetRight,
        bottom = windowInsets.systemWindowInsetBottom,
        left = windowInsets.systemWindowInsetLeft,
      )
    }

  private fun configureEdgeToEdgeWindow() {
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      window.setDecorFitsSystemWindows(false)
    } else {
      @Suppress("DEPRECATION")
      window.decorView.systemUiVisibility =
        View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
          View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
          View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
    }
  }

  private fun minimizeToStudio() {
    if (!contentReady && !startupFailed && !crashed) {
      failStartup(
        stage = "lifecycle",
        code = "minimized_before_ready",
        rawMessage = null,
        fallbackMessage = "Native Preview was minimized before its first content draw",
        returnToStudio = false,
      )
    }
    returnToStudio()
  }

  private fun scheduleReturnToStudio() {
    mainHandler.postDelayed({ returnToStudio() }, FAILURE_DISPLAY_MS)
  }

  private fun returnToStudio() {
    NativePreviewTaskLifecycle.minimize(
      moveTaskToBack = ::moveTaskToBack,
      finish = ::finish,
    )
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

  private fun previewThemeAccent(): Int =
    if (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES) {
      Color.rgb(109, 145, 255)
    } else {
      Color.rgb(53, 108, 255)
    }

  companion object {
    const val EXTRA_BUNDLE_PATH = "runwhale.bundle.path"
    const val EXTRA_SOURCE_ID = "runwhale.bundle.source-id"
    const val EXTRA_REQUEST_ID = "runwhale.preview.request-id"
    const val EXTRA_PROJECT_ID = "runwhale.preview.project-id"
    const val DIAGNOSTIC_PREFERENCES = NativePreviewDiagnostics.PREFERENCES
    const val DIAGNOSTIC_KEY = NativePreviewDiagnostics.KEY
    const val BUNDLE_FILE_PREFIX = "runwhale-native-preview-"
    const val BUNDLE_FILE_SUFFIX = ".bundle"

    private const val PREVIEW_SCRIPT_URL = "runwhale://native-preview/android"
    private const val STATE_PENDING_REQUESTS = "runwhale.preview.pending-requests"
    private const val STATE_CONTENT_READY = "runwhale.preview.content-ready"
    private const val STATE_PROJECT_ID = "runwhale.preview.state.project-id"
    private const val SURFACE_START_TIMEOUT_MS = 15_000L
    private const val CONTENT_READY_TIMEOUT_MS = 20_000L
    private const val FAILURE_DISPLAY_MS = 350L
    private val SOURCE_ID_PATTERN = Regex("[a-f0-9]{64}")
    private val PREVIEW_BUNDLE_NAME_PATTERN = Regex("$BUNDLE_FILE_PREFIX[a-f0-9]{64}\\$BUNDLE_FILE_SUFFIX")
  }
}
