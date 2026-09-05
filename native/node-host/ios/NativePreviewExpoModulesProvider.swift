import ExpoModulesCore

@objc(RunWhaleNativePreviewExpoModulesProvider)
public final class NativePreviewExpoModulesProvider: ModulesProvider {
  private let linkedProvider = AppContext.modulesProvider()

  private let allowedModuleClasses: Set<String> = [
    "AccelerometerModule",
    "AesCryptoModule",
    "AssetModule",
    "AudioModule",
    "BarometerModule",
    "BatteryModule",
    "BlurViewModule",
    "CameraViewModule",
    "ClipboardModule",
    "ContactAccessButtonModule",
    "ConstantsModule",
    "ContactsModule",
    "ContactsNextModule",
    "CryptoModule",
    "DeviceModule",
    "DeviceMotionModule",
    "DocumentPickerModule",
    "DomWebViewModule",
    "ExpoFetchModule",
    "ExpoHeadModule",
    "ExpoLinkingModule",
    "ExpoSystemUIModule",
    "ExpoUIModule",
    "FileSystemLegacyModule",
    "FileSystemModule",
    "FontLoaderModule",
    "FontUtilsModule",
    "GlassEffectModule",
    "GyroscopeModule",
    "HapticsModule",
    "ImageManipulatorModule",
    "ImageModule",
    "ImagePickerModule",
    "KeepAwakeModule",
    "LinearGradientModule",
    "LinkPreviewNativeModule",
    "LocalAuthenticationModule",
    "LocalizationModule",
    "LocationModule",
    "MagnetometerModule",
    "MagnetometerUncalibratedModule",
    "MapsModule",
    "AppleMapsModule",
    "MediaLibraryModule",
    "MediaLibraryNextModule",
    "NetworkModule",
    "RouterToolbarModule",
    "ScreenCaptureModule",
    "ScreenOrientationModule",
    "SharingModule",
    "SpeechModule",
    "SymbolModule",
    "VideoModule",
    "WebBrowserModule",
  ]

  public required init() {
    super.init()
  }

  public override func getModuleClasses() -> [ExpoModuleTupleType] {
    let linkedModules = linkedProvider.getModuleClasses().filter { module in
      let qualifiedName = String(reflecting: module.module)
      return allowedModuleClasses.contains(qualifiedName.split(separator: ".").last.map(String.init) ?? qualifiedName)
    }
    return linkedModules + [(module: NativePreviewStorageModule.self, name: nil)]
  }

  public override func getAppDelegateSubscribers() -> [ExpoAppDelegateSubscriber.Type] {
    []
  }

  public override func getReactDelegateHandlers() -> [ExpoReactDelegateHandlerTupleType] {
    []
  }

  public override func getAppCodeSignEntitlements() -> AppCodeSignEntitlements {
    AppCodeSignEntitlements.from(json: "{}")
  }
}
