package com.runwhale.nodehost

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.ViewManager
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.atomic.AtomicInteger

internal object NativePreviewLanguage {
  @Volatile var language: String? = null
    private set
  val listeners = CopyOnWriteArraySet<() -> Unit>()
  @Volatile var closePreviewLabel: String = "Close Preview"
    private set
  fun set(next: String, closeLabel: String) {
    require(next in setOf("en", "zh-CN", "es", "fr", "ja")) { "Unsupported RunWhale language." }
    closePreviewLabel = closeLabel
    if (language == next) return
    language = next
    listeners.forEach { it() }
  }
}

internal class RunWhaleSettings(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val listenerCount = AtomicInteger(0)
  private val onLanguageChanged: () -> Unit = {
    if (listenerCount.get() > 0 && reactApplicationContext.hasActiveReactInstance()) {
      reactApplicationContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("runwhaleLanguageChanged", null)
    }
  }
  override fun getName() = "RunWhaleSettings"
  override fun initialize() { super.initialize(); NativePreviewLanguage.listeners.add(onLanguageChanged) }
  override fun invalidate() { NativePreviewLanguage.listeners.remove(onLanguageChanged); super.invalidate() }
  @ReactMethod(isBlockingSynchronousMethod = true)
  fun getLanguage(): String? = NativePreviewLanguage.language
  @ReactMethod fun addListener(eventName: String) { listenerCount.incrementAndGet() }
  @ReactMethod fun removeListeners(count: Double) { listenerCount.addAndGet(-count.toInt()) }
}

internal class RunWhaleSettingsPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(RunWhaleSettings(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
