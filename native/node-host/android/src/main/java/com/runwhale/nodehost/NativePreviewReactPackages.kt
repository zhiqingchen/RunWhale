package com.runwhale.nodehost

import android.app.Application
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.shell.MainReactPackage
import com.facebook.react.uimanager.ViewManager
import expo.modules.adapters.react.ModuleRegistryAdapter
import expo.modules.adapters.react.ReactModuleRegistryProvider
import expo.modules.core.interfaces.Package
import expo.modules.kotlin.ExpoModulesHelper
import expo.modules.kotlin.ModulesProvider
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.services.Service

internal object NativePreviewReactPackages {
  private val allowedReactPackageClasses = setOf(
    "com.shopify.reactnative.skia.RNSkiaPackage",
    "com.horcrux.svg.SvgPackage",
    "com.reactnativecommunity.webview.RNCWebViewPackage",
    "com.swmansion.gesturehandler.RNGestureHandlerPackage",
    "com.swmansion.reanimated.ReanimatedPackage",
    "com.swmansion.rnscreens.RNScreensPackage",
    "com.swmansion.worklets.WorkletsPackage",
    "com.th3rdwave.safeareacontext.SafeAreaContextPackage",
  )

  fun create(application: Application, projectId: String): List<ReactPackage> {
    val projectScope = NativePreviewProjectScope.create(application, projectId)
    val linkedPackages = runCatching {
      val packageListClass = Class.forName("com.facebook.react.PackageList")
      val packageList = packageListClass.getConstructor(Application::class.java).newInstance(application)
      @Suppress("UNCHECKED_CAST")
      packageListClass.getMethod("getPackages").invoke(packageList) as List<ReactPackage>
    }.getOrElse { error ->
      throw IllegalStateException("Native Preview could not read the app's linked React packages", error)
    }
    return buildList {
      add(MainReactPackage())
      add(NativePreviewExpoModulesPackage(projectScope))
      addAll(linkedPackages.filter { it.javaClass.name in allowedReactPackageClasses })
    }
  }
}

private class NativePreviewExpoModulesPackage(
  private val projectScope: NativePreviewProjectScope,
) : ReactPackage {
  private val adapter = ModuleRegistryAdapter(
    ReactModuleRegistryProvider(linkedExpoPackages()),
    NativePreviewExpoModulesProvider,
  )

  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    NativePreviewProjectScopeContext.withScope(projectScope) {
      adapter.createNativeModules(reactContext)
    }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    NativePreviewProjectScopeContext.withScope(projectScope) {
      adapter.createViewManagers(reactContext)
    }

  private companion object {
    private val allowedPackageClasses = setOf(
      "expo.modules.adapters.react.ReactAdapterPackage",
      "expo.modules.constants.ConstantsPackage",
      "expo.modules.core.BasePackage",
      "expo.modules.kotlin.edgeToEdge.EdgeToEdgePackage",
      "expo.modules.linking.ExpoLinkingPackage",
      "expo.modules.localization.LocalizationPackage",
      "expo.modules.sharing.SharingPackage",
      "expo.modules.statusbar.StatusBarPackage",
      "expo.modules.systemui.SystemUIPackage",
      "expo.modules.webbrowser.WebBrowserPackage",
    )

    private fun linkedExpoPackages(): List<Package> = runCatching {
      val packageListClass = Class.forName("expo.modules.ExpoModulesPackageList")
      @Suppress("UNCHECKED_CAST")
      val packages = packageListClass.getMethod("getPackageList").invoke(null) as List<Package>
      packages.filter { it.javaClass.name in allowedPackageClasses }
    }.getOrElse { error ->
      throw IllegalStateException("Native Preview could not read the app's linked Expo packages", error)
    }
  }
}

private object NativePreviewExpoModulesProvider : ModulesProvider {
  private val allowedModuleClasses = setOf(
    "expo.modules.asset.AssetModule",
    "expo.modules.audio.AudioModule",
    "expo.modules.battery.BatteryModule",
    "expo.modules.blur.BlurModule",
    "expo.modules.camera.CameraViewModule",
    "expo.modules.clipboard.ClipboardModule",
    "expo.modules.constants.ConstantsModule",
    "expo.modules.contacts.ContactsModule",
    "expo.modules.contacts.next.ContactsNextModule",
    "expo.modules.crypto.CryptoModule",
    "expo.modules.crypto.aes.AesCryptoModule",
    "expo.modules.device.DeviceModule",
    "expo.modules.documentpicker.DocumentPickerModule",
    "expo.modules.fetch.ExpoFetchModule",
    "expo.modules.filesystem.FileSystemModule",
    "expo.modules.filesystem.legacy.FileSystemLegacyModule",
    "expo.modules.font.FontLoaderModule",
    "expo.modules.font.FontUtilsModule",
    "expo.modules.haptics.HapticsModule",
    "expo.modules.image.ExpoImageModule",
    "expo.modules.imagemanipulator.ImageManipulatorModule",
    "expo.modules.imagepicker.ImagePickerModule",
    "expo.modules.keepawake.KeepAwakeModule",
    "expo.modules.lineargradient.LinearGradientModule",
    "expo.modules.linking.ExpoLinkingModule",
    "expo.modules.localauthentication.LocalAuthenticationModule",
    "expo.modules.localization.LocalizationModule",
    "expo.modules.location.LocationModule",
    "expo.modules.maps.GoogleMapsModule",
    "expo.modules.maps.MapsModule",
    "expo.modules.maps.StreetViewModule",
    "expo.modules.medialibrary.MediaLibraryModule",
    "expo.modules.medialibrary.next.MediaLibraryNextModule",
    "expo.modules.network.NetworkModule",
    "expo.modules.router.ExpoRouterModule",
    "expo.modules.screencapture.ScreenCaptureModule",
    "expo.modules.screenorientation.ScreenOrientationModule",
    "expo.modules.sensors.modules.AccelerometerModule",
    "expo.modules.sensors.modules.BarometerModule",
    "expo.modules.sensors.modules.DeviceMotionModule",
    "expo.modules.sensors.modules.GyroscopeModule",
    "expo.modules.sensors.modules.LightSensorModule",
    "expo.modules.sensors.modules.MagnetometerModule",
    "expo.modules.sensors.modules.MagnetometerUncalibratedModule",
    "expo.modules.sharing.SharingModule",
    "expo.modules.speech.SpeechModule",
    "expo.modules.systemui.SystemUIModule",
    "expo.modules.ui.ExpoUIModule",
    "expo.modules.video.VideoModule",
    "expo.modules.webbrowser.WebBrowserModule",
    "expo.modules.webview.DomWebViewModule",
  )
  private val allowedServiceClasses = setOf(
    "expo.modules.constants.ConstantsService",
    "expo.modules.imageloader.ImageLoaderService",
  )

  override fun getModulesMap(): Map<Class<out Module>, String?> = buildMap {
    ExpoModulesHelper.modulesProvider?.getModulesMap()
      ?.filterKeys { it.name in allowedModuleClasses }
      ?.let(::putAll)
    put(NativePreviewStorageModule::class.java, NativePreviewStorageModule.MODULE_NAME)
  }

  override fun getServices(): List<Class<out Service>> = buildList {
    ExpoModulesHelper.modulesProvider?.getServices()
      ?.filter { it.name in allowedServiceClasses }
      ?.let(::addAll)
    add(NativePreviewAppDirectoriesService::class.java)
    add(NativePreviewFilePermissionService::class.java)
  }
}
