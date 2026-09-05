#import "NativePreviewBridge.h"

#import "RCTDefaultReactNativeFactoryDelegate.h"
#import "RCTDependencyProvider.h"
#import "RCTReactNativeFactory.h"
#import <ExpoModulesCore/EXAppContextProtocol.h>
#import <ExpoModulesCore/EXFilePermissionModuleInterface.h>
#import <ExpoModulesCore/EXFileSystemInterface.h>
#import <ExpoModulesCore/EXHostWrapper.h>
#import <ExpoModulesCore/EXInternalModule.h>
#import <ExpoModulesCore/EXReactSchedulerDispatch.h>
#import <ExpoModulesCore/ExpoFabricViewObjC.h>
#import <React/RCTComponentViewFactory.h>
#import <React/RCTJavaScriptLoader.h>
#import <React/RCTRootView.h>
#import <React/RCTSurfacePresenter.h>
#import <React/RCTSurfaceHostingProxyRootView.h>
#import <React/RCTUtils.h>
#import <ReactCommon/RCTHost.h>
#import <react/renderer/runtimescheduler/RuntimeSchedulerBinding.h>
#include <jsi/jsi.h>
#import <objc/runtime.h>

#if __has_include(<ExpoModulesCore/ExpoModulesCore-Swift.h>)
#import <ExpoModulesCore/ExpoModulesCore-Swift.h>
#else
#import "ExpoModulesCore-Swift.h"
#endif

#if __has_include(<RunWhaleNodeHost/RunWhaleNodeHost-Swift.h>)
#import <RunWhaleNodeHost/RunWhaleNodeHost-Swift.h>
#else
#import "RunWhaleNodeHost-Swift.h"
#endif

static NSString *const RunWhaleNativePreviewDiagnosticKey = @"RunWhaleNativePreviewLastDiagnostic";
static NSString *const RunWhaleNativePreviewAppIdentifier = @"runwhale_native_preview";
static NSTimeInterval const RunWhaleNativePreviewStartupTimeout = 20.0;
static CGFloat const RunWhalePreviewControlSize = 48.0;
static CGFloat const RunWhalePreviewControlGap = 8.0;
static NSString *const RunWhaleNativePreviewStorageErrorDomain = @"RunWhaleNativePreviewStorage";

static NSURL *_Nullable RunWhaleCanonicalFileURL(NSURL *url) {
  if (!url.isFileURL || url.host.length > 0) return nil;

  NSFileManager *fileManager = NSFileManager.defaultManager;
  NSURL *existing = url.URLByStandardizingPath;
  NSMutableArray<NSString *> *missingComponents = [NSMutableArray new];
  while (![fileManager fileExistsAtPath:existing.path]) {
    NSString *component = existing.lastPathComponent;
    NSURL *parent = existing.URLByDeletingLastPathComponent;
    if (component.length == 0 || [parent.path isEqualToString:existing.path]) return nil;
    [missingComponents insertObject:component atIndex:0];
    existing = parent;
  }

  NSURL *canonical = existing.URLByResolvingSymlinksInPath.URLByStandardizingPath;
  for (NSString *component in missingComponents) {
    if ([component isEqualToString:@"."] || [component isEqualToString:@".."]) return nil;
    canonical = [canonical URLByAppendingPathComponent:component];
  }
  return canonical.URLByStandardizingPath;
}

static NSError *RunWhaleNativePreviewStorageError(void) {
  return [NSError errorWithDomain:RunWhaleNativePreviewStorageErrorDomain
                             code:1
                         userInfo:@{NSLocalizedDescriptionKey : @"Native Preview project storage could not be created."}];
}

static BOOL RunWhaleIsValidNativePreviewProjectIdentifier(NSString *projectIdentifier) {
  NSRange match = [projectIdentifier rangeOfString:@"^[a-z0-9][a-z0-9-]{1,62}$"
                                           options:NSRegularExpressionSearch];
  return match.location == 0 && match.length == projectIdentifier.length;
}

static NSURL *_Nullable RunWhaleCreateNativePreviewDirectory(
    NSURL *parent,
    NSString *name,
    NSError **error) {
  NSURL *canonicalParent = RunWhaleCanonicalFileURL(parent);
  if (canonicalParent == nil) {
    if (error != NULL) *error = RunWhaleNativePreviewStorageError();
    return nil;
  }
  NSURL *candidate = [canonicalParent URLByAppendingPathComponent:name isDirectory:YES];
  NSFileManager *fileManager = NSFileManager.defaultManager;
  BOOL isDirectory = NO;
  if ([fileManager fileExistsAtPath:candidate.path isDirectory:&isDirectory]) {
    if (!isDirectory) {
      if (error != NULL) *error = RunWhaleNativePreviewStorageError();
      return nil;
    }
  } else {
    NSError *creationError;
    if (![fileManager createDirectoryAtURL:candidate
               withIntermediateDirectories:NO
                                attributes:nil
                                     error:&creationError]) {
      // Another Preview launch may have created this directory between the
      // existence check and createDirectoryAtURL:. Accept that race only after
      // verifying that the resulting path is a directory; canonical validation
      // below still rejects a symlink that escapes the project storage root.
      if (![fileManager fileExistsAtPath:candidate.path isDirectory:&isDirectory] || !isDirectory) {
        if (error != NULL) *error = creationError;
        return nil;
      }
    }
  }
  NSURL *canonical = RunWhaleCanonicalFileURL(candidate);
  NSURL *expected = candidate.URLByStandardizingPath;
  if (canonical == nil || ![canonical.path isEqualToString:expected.path]) {
    if (error != NULL) *error = RunWhaleNativePreviewStorageError();
    return nil;
  }
  return canonical;
}

static NSURL *_Nullable RunWhaleNativePreviewBaseDirectory(
    NSSearchPathDirectory searchPath,
    NSError **error) {
  NSURL *base = [NSFileManager.defaultManager URLsForDirectory:searchPath
                                                     inDomains:NSUserDomainMask].firstObject;
  if (base == nil) {
    if (error != NULL) *error = RunWhaleNativePreviewStorageError();
    return nil;
  }
  if (![NSFileManager.defaultManager createDirectoryAtURL:base
                              withIntermediateDirectories:YES
                                               attributes:nil
                                                    error:error]) {
    return nil;
  }
  return RunWhaleCanonicalFileURL(base);
}

static NSURL *_Nullable RunWhaleCreateNativePreviewLeafDirectory(
    NSSearchPathDirectory searchPath,
    NSString *projectIdentifier,
    NSString *leaf,
    NSError **error) {
  NSURL *base = RunWhaleNativePreviewBaseDirectory(searchPath, error);
  if (base == nil) return nil;
  NSURL *preview = RunWhaleCreateNativePreviewDirectory(base, @"runwhale-native-preview", error);
  if (preview == nil) return nil;
  NSURL *projects = RunWhaleCreateNativePreviewDirectory(preview, @"projects", error);
  if (projects == nil) return nil;
  NSURL *project = RunWhaleCreateNativePreviewDirectory(projects, projectIdentifier, error);
  if (project == nil) return nil;
  return RunWhaleCreateNativePreviewDirectory(project, leaf, error);
}

static EXAppContext *_Nullable RunWhaleCreateNativePreviewAppContext(
    NSString *projectIdentifier,
    NSError **error) {
  if (!RunWhaleIsValidNativePreviewProjectIdentifier(projectIdentifier)) {
    if (error != NULL) *error = RunWhaleNativePreviewStorageError();
    return nil;
  }

  NSURL *files = RunWhaleCreateNativePreviewLeafDirectory(
      NSApplicationSupportDirectory, projectIdentifier, @"files", error);
  if (files == nil) return nil;
  NSURL *support = RunWhaleCreateNativePreviewLeafDirectory(
      NSApplicationSupportDirectory, projectIdentifier, @"support", error);
  if (support == nil) return nil;
  NSURL *cache = RunWhaleCreateNativePreviewLeafDirectory(
      NSCachesDirectory, projectIdentifier, @"cache", error);
  if (cache == nil) return nil;

  EXFileSystemLegacyUtilities *fileSystemManager =
      [[EXFileSystemLegacyUtilities alloc] initWithDocumentDirectory:files.path
                                                    cachesDirectory:cache.path
                                        applicationSupportDirectory:support.path];
  return [RunWhaleNativePreviewAppContextFactory makeAppContextWithDocumentDirectory:files
                                                                       cacheDirectory:cache
                                                                   fileSystemManager:fileSystemManager];
}

static void RunWhaleRestoreStudioStatusBar(void) {
  NSCAssert(NSThread.isMainThread, @"The Studio status bar must be restored on the main thread");
  UIWindow *window = RCTKeyWindow();
  UIStatusBarStyle style = window.traitCollection.userInterfaceStyle == UIUserInterfaceStyleDark
      ? UIStatusBarStyleLightContent
      : UIStatusBarStyleDarkContent;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  [RCTSharedApplication() setStatusBarHidden:NO withAnimation:UIStatusBarAnimationNone];
  [RCTSharedApplication() setStatusBarStyle:style animated:NO];
#pragma clang diagnostic pop
}

typedef NSString *_Nullable (*RunWhaleAppContextIdentifierGetter)(id, SEL);

static const void *RunWhaleAppContextIdentifierAssociation = &RunWhaleAppContextIdentifierAssociation;
static RunWhaleAppContextIdentifierGetter RunWhaleOriginalAppContextIdentifierGetter;

static NSString *_Nullable RunWhaleAppContextIdentifier(id appContext, SEL selector) {
  NSString *identifier = objc_getAssociatedObject(appContext, RunWhaleAppContextIdentifierAssociation);
  if (identifier != nil) return identifier;
  return RunWhaleOriginalAppContextIdentifierGetter == nullptr
      ? nil
      : RunWhaleOriginalAppContextIdentifierGetter(appContext, selector);
}

static void RunWhaleSetNativePreviewAppIdentifier(EXAppContext *appContext) {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    Method method = class_getInstanceMethod(EXAppContext.class, @selector(appIdentifier));
    NSCAssert(method != NULL, @"Expo AppContext must expose appIdentifier");
    if (method == NULL) return;
    IMP original = method_setImplementation(method, (IMP)RunWhaleAppContextIdentifier);
    RunWhaleOriginalAppContextIdentifierGetter = (RunWhaleAppContextIdentifierGetter)original;
  });
  objc_setAssociatedObject(
      appContext,
      RunWhaleAppContextIdentifierAssociation,
      RunWhaleNativePreviewAppIdentifier,
      OBJC_ASSOCIATION_COPY_NONATOMIC);
}

static void RunWhaleInstallNativePreviewAppIdentifier(facebook::jsi::Runtime &runtime) {
  auto expo = runtime.global().getProperty(runtime, "expo");
  NSCAssert(expo.isObject(), @"Expo must install its global object before Native Preview registers modules");
  if (!expo.isObject()) return;
  expo.asObject(runtime).setProperty(
      runtime,
      "__expo_app_identifier__",
      facebook::jsi::String::createFromUtf8(runtime, RunWhaleNativePreviewAppIdentifier.UTF8String));
}

static UIColor *RunWhalePreviewAccentColor(void) {
  return [UIColor colorWithDynamicProvider:^UIColor *(UITraitCollection *traitCollection) {
    if (traitCollection.userInterfaceStyle == UIUserInterfaceStyleDark) {
      return [UIColor colorWithRed:109.0 / 255.0 green:145.0 / 255.0 blue:255.0 / 255.0 alpha:1.0];
    }
    return [UIColor colorWithRed:53.0 / 255.0 green:108.0 / 255.0 blue:255.0 / 255.0 alpha:1.0];
  }];
}

static UIColor *RunWhalePreviewControlBackgroundColor(void) {
  return [UIColor colorWithRed:7.0 / 255.0
                         green:24.0 / 255.0
                          blue:42.0 / 255.0
                         alpha:184.0 / 255.0];
}

static UIButtonConfiguration *RunWhalePreviewControlConfiguration(UIImage *image, BOOL highlighted) {
  UIButtonConfiguration *configuration = [UIButtonConfiguration plainButtonConfiguration];
  configuration.image = image;
  configuration.baseForegroundColor = RunWhalePreviewAccentColor();
  configuration.contentInsets = NSDirectionalEdgeInsetsMake(14.0, 14.0, 14.0, 14.0);
  configuration.cornerStyle = UIButtonConfigurationCornerStyleFixed;
  configuration.background.backgroundColor = highlighted
      ? [RunWhalePreviewAccentColor() colorWithAlphaComponent:80.0 / 255.0]
      : RunWhalePreviewControlBackgroundColor();
  configuration.background.cornerRadius = RunWhalePreviewControlSize / 2.0;
  return configuration;
}

static NSString *RunWhaleBoundedPreviewText(NSString *value, NSUInteger limit) {
  if (value.length <= limit) return value;
  NSRange finalSequence = [value rangeOfComposedCharacterSequenceAtIndex:limit - 1];
  NSUInteger end = NSMaxRange(finalSequence) > limit ? finalSequence.location : limit;
  return [value substringToIndex:end];
}

static NSString *RunWhaleSanitizePreviewMessage(NSString *message) {
  NSString *sanitized = message.length > 0 ? message : @"Native Preview failed";
  sanitized = [[sanitized componentsSeparatedByCharactersInSet:NSCharacterSet.newlineCharacterSet]
      componentsJoinedByString:@" "];
  sanitized = RunWhaleBoundedPreviewText(sanitized, 2048);

  NSArray<NSArray<NSString *> *> *redactions = @[
    @[@"(?i)\\bhttps?://[^\\s\\\"'<>]+", @"<redacted-url>"],
    @[@"(?i)(authorization\\s*[:=]\\s*(?:bearer\\s+)?)[^\\s,;]+", @"$1<redacted>"],
    @[@"(?i)((?:token|api[-_ ]?key|secret|password)\\s*[:=]\\s*)[^\\s,;&]+", @"$1<redacted>"],
    @[@"([?&][^=\\s&#]{1,64}=)[^\\s&#]*", @"$1<redacted>"],
  ];
  for (NSArray<NSString *> *redaction in redactions) {
    NSRegularExpression *expression = [NSRegularExpression regularExpressionWithPattern:redaction[0]
                                                                                  options:0
                                                                                    error:nil];
    sanitized = [expression stringByReplacingMatchesInString:sanitized
                                                     options:0
                                                       range:NSMakeRange(0, sanitized.length)
                                                withTemplate:redaction[1]];
  }
  return RunWhaleBoundedPreviewText(
      [sanitized stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet], 2048);
}

NSString *RunWhaleRecordNativePreviewDiagnostic(NSString *stage, NSString *code, NSString *message) {
  NSString *safeMessage = RunWhaleSanitizePreviewMessage(message);
  NSDictionary<NSString *, id> *diagnostic = @{
    @"version" : @1,
    @"platform" : @"ios",
    @"stage" : stage,
    @"code" : code,
    @"message" : safeMessage,
    @"timestamp" : @((long long)(NSDate.date.timeIntervalSince1970 * 1000.0)),
  };
  NSData *data = [NSJSONSerialization dataWithJSONObject:diagnostic options:0 error:nil];
  NSString *encoded = data == nil ? safeMessage : [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  [NSUserDefaults.standardUserDefaults setObject:encoded forKey:RunWhaleNativePreviewDiagnosticKey];
  return safeMessage;
}

NSString *_Nullable RunWhaleTakeNativePreviewDiagnostic(void) {
  NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
  NSString *diagnostic = [defaults stringForKey:RunWhaleNativePreviewDiagnosticKey];
  if (diagnostic != nil) [defaults removeObjectForKey:RunWhaleNativePreviewDiagnosticKey];
  return diagnostic;
}

@interface RunWhaleNativePreviewDependencyProvider : NSObject <RCTDependencyProvider>
@end

@implementation RunWhaleNativePreviewDependencyProvider

- (id<RCTDependencyProvider>)linkedProvider {
  Class providerClass = NSClassFromString(@"RCTAppDependencyProvider");
  id provider = providerClass == Nil ? nil : [providerClass new];
  return [provider conformsToProtocol:@protocol(RCTDependencyProvider)] ? provider : nil;
}

- (NSArray<NSString *> *)imageURLLoaderClassNames {
  return @[];
}

- (NSArray<NSString *> *)imageDataDecoderClassNames {
  return @[];
}

- (NSArray<NSString *> *)URLRequestHandlerClassNames {
  return @[];
}

- (NSArray<NSString *> *)unstableModulesRequiringMainQueueSetup {
  NSArray<NSString *> *linked = self.linkedProvider.unstableModulesRequiringMainQueueSetup;
  return [linked containsObject:@"RNSkiaModule"] ? @[@"RNSkiaModule"] : @[];
}

- (NSDictionary<NSString *, Class<RCTComponentViewProtocol>> *)thirdPartyFabricComponents {
  NSDictionary<NSString *, Class<RCTComponentViewProtocol>> *linked = self.linkedProvider.thirdPartyFabricComponents;
  if (linked.count == 0) return @{};
  NSArray<NSString *> *allowedPrefixes = @[@"REA", @"RNCWebView", @"RNCSafeArea", @"RNGesture", @"RNS", @"RNSVG", @"Skia"];
  NSMutableDictionary<NSString *, Class<RCTComponentViewProtocol>> *filtered = [NSMutableDictionary new];
  [linked enumerateKeysAndObjectsUsingBlock:^(NSString *name, Class<RCTComponentViewProtocol> component, BOOL *stop) {
    for (NSString *prefix in allowedPrefixes) {
      if ([name hasPrefix:prefix]) {
        filtered[name] = component;
        break;
      }
    }
  }];
  return filtered;
}

- (NSDictionary<NSString *, id<RCTModuleProvider>> *)moduleProviders {
  NSDictionary<NSString *, id<RCTModuleProvider>> *linked = self.linkedProvider.moduleProviders;
  NSMutableDictionary<NSString *, id<RCTModuleProvider>> *filtered = [NSMutableDictionary new];
  for (NSString *name in @[@"RNCWebViewModule", @"RNSkiaModule"]) {
    id<RCTModuleProvider> provider = linked[name];
    if (provider != nil) filtered[name] = provider;
  }
  return filtered;
}

@end

typedef void (^RunWhaleNativePreviewRuntimeFailureHandler)(NSString *stage, NSString *code, NSString *message);

static void RunWhaleInstallNativePreviewFatalReporter(
    facebook::jsi::Runtime &runtime,
    facebook::jsi::Object &errorUtils,
    RunWhaleNativePreviewRuntimeFailureHandler runtimeFailureHandler) {
  facebook::jsi::Function fatalReporter = facebook::jsi::Function::createFromHostFunction(
      runtime,
      facebook::jsi::PropNameID::forAscii(runtime, "runWhaleNativePreviewFatalReporter"),
      1,
      [runtimeFailureHandler](facebook::jsi::Runtime &reporterRuntime,
                              const facebook::jsi::Value &thisValue,
                              const facebook::jsi::Value *arguments,
                              size_t count) -> facebook::jsi::Value {
        NSString *message = @"The Preview JavaScript runtime failed.";
        if (count > 0 && arguments[0].isObject()) {
          facebook::jsi::Value messageValue = arguments[0].getObject(reporterRuntime).getProperty(reporterRuntime, "message");
          if (messageValue.isString()) {
            message = [NSString stringWithUTF8String:messageValue.getString(reporterRuntime).utf8(reporterRuntime).c_str()];
          }
        }
        if (runtimeFailureHandler != nil) {
          runtimeFailureHandler(@"javascript", @"javascript_fatal", message);
        }
        return facebook::jsi::Value::undefined();
      });
  errorUtils.setProperty(runtime, "reportFatalError", std::move(fatalReporter));
}

@interface RunWhaleNativePreviewFactory : RCTReactNativeFactory <RCTComponentViewFactoryComponentProvider>
@property(nonatomic, copy) RunWhaleNativePreviewRuntimeFailureHandler runtimeFailureHandler;
@property(nonatomic, copy) NSString *projectIdentifier;
@end

@implementation RunWhaleNativePreviewFactory {
  EXAppContext *_previewAppContext;
}

- (NSDictionary<NSString *, Class<RCTComponentViewProtocol>> *)thirdPartyFabricComponents {
  return [RunWhaleNativePreviewDependencyProvider new].thirdPartyFabricComponents;
}

- (void)loadBundleAtURL:(NSURL *)sourceURL
             onProgress:(RCTSourceLoadProgressBlock)onProgress
             onComplete:(RCTSourceLoadBlock)loadCallback {
  __weak RunWhaleNativePreviewFactory *weakSelf = self;
  [RCTJavaScriptLoader loadBundleAtURL:sourceURL
                           onProgress:onProgress
                           onComplete:^(NSError *error, RCTSource *source) {
                             if (error != nil && weakSelf.runtimeFailureHandler != nil) {
                               weakSelf.runtimeFailureHandler(
                                   @"bundle-load", @"bundle_load_failed", @"The Native Preview bundle could not be loaded.");
                             }
                             loadCallback(error, source);
                           }];
}

- (void)host:(RCTHost *)host didInitializeRuntime:(facebook::jsi::Runtime &)runtime {
  NSError *storageError;
  _previewAppContext = RunWhaleCreateNativePreviewAppContext(self.projectIdentifier, &storageError);
  if (_previewAppContext == nil) {
    if (self.runtimeFailureHandler != nil) {
      self.runtimeFailureHandler(
          @"host-create", @"project_storage_failed", @"Native Preview project storage could not be created.");
    }
    return;
  }
  // Expo namespaces Fabric view classes by AppContext.appIdentifier. A custom
  // bridgeless context has no RCTBridge, so Expo otherwise returns nil here and
  // reuses the Studio view classes. The Preview registration would then replace
  // their initializers with a weak reference to this short-lived context.
  RunWhaleSetNativePreviewAppIdentifier(_previewAppContext);
  auto binding = facebook::react::RuntimeSchedulerBinding::getBinding(runtime);
  auto scheduler = binding ? binding->getRuntimeScheduler() : nullptr;
  void *schedulerHandle = expo::createReactSchedulerHandle(scheduler);
  [_previewAppContext setRuntime:&runtime
                      scheduler:schedulerHandle
                       dispatch:schedulerHandle ? reinterpret_cast<const void *>(&expo::dispatchOnReactScheduler) : nullptr];
  RunWhaleInstallNativePreviewAppIdentifier(runtime);
  [_previewAppContext setHostWrapper:[[EXHostWrapper alloc] initWithHost:host]];
  [_previewAppContext registerNativeModulesWithProvider:[RunWhaleNativePreviewExpoModulesProvider new]];

  RunWhaleNativePreviewRuntimeFailureHandler runtimeFailureHandler = [self.runtimeFailureHandler copy];
  facebook::jsi::Value errorUtilsValue = runtime.global().getProperty(runtime, "ErrorUtils");
  if (errorUtilsValue.isObject()) {
    facebook::jsi::Object errorUtils = errorUtilsValue.getObject(runtime);
    RunWhaleInstallNativePreviewFatalReporter(runtime, errorUtils, runtimeFailureHandler);
  }

  // React Native installs ErrorUtils from the bundle after this callback. Keep
  // its assignment semantics while replacing only the fatal-reporting entry.
  auto errorUtilsStorage = std::make_shared<facebook::jsi::Value>(facebook::jsi::Value(runtime, errorUtilsValue));
  facebook::jsi::Function getter = facebook::jsi::Function::createFromHostFunction(
      runtime,
      facebook::jsi::PropNameID::forAscii(runtime, "getRunWhaleNativePreviewErrorUtils"),
      0,
      [errorUtilsStorage](facebook::jsi::Runtime &getterRuntime,
                          const facebook::jsi::Value &thisValue,
                          const facebook::jsi::Value *arguments,
                          size_t count) -> facebook::jsi::Value {
        return facebook::jsi::Value(getterRuntime, *errorUtilsStorage);
      });
  facebook::jsi::Function setter = facebook::jsi::Function::createFromHostFunction(
      runtime,
      facebook::jsi::PropNameID::forAscii(runtime, "setRunWhaleNativePreviewErrorUtils"),
      1,
      [errorUtilsStorage, runtimeFailureHandler](facebook::jsi::Runtime &setterRuntime,
                                                 const facebook::jsi::Value &thisValue,
                                                 const facebook::jsi::Value *arguments,
                                                 size_t count) -> facebook::jsi::Value {
        if (count > 0) {
          *errorUtilsStorage = facebook::jsi::Value(setterRuntime, arguments[0]);
          if (arguments[0].isObject()) {
            facebook::jsi::Object errorUtils = arguments[0].getObject(setterRuntime);
            RunWhaleInstallNativePreviewFatalReporter(setterRuntime, errorUtils, runtimeFailureHandler);
          }
        }
        return facebook::jsi::Value::undefined();
      });
  facebook::jsi::Object descriptor(runtime);
  descriptor.setProperty(runtime, "configurable", true);
  descriptor.setProperty(runtime, "enumerable", true);
  descriptor.setProperty(runtime, "get", std::move(getter));
  descriptor.setProperty(runtime, "set", std::move(setter));
  facebook::jsi::Object objectConstructor = runtime.global().getPropertyAsObject(runtime, "Object");
  objectConstructor.getPropertyAsFunction(runtime, "defineProperty")
      .callWithThis(runtime,
                    objectConstructor,
                    runtime.global(),
                    facebook::jsi::String::createFromAscii(runtime, "ErrorUtils"),
                    descriptor);
}

@end

@interface RunWhaleNativePreviewDelegate : RCTDefaultReactNativeFactoryDelegate
@property(nonatomic, strong) NSURL *previewBundleURL;
@end

@implementation RunWhaleNativePreviewDelegate

- (NSURL *)bundleURL {
  return self.previewBundleURL;
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge {
  return self.previewBundleURL;
}

@end

@interface RunWhaleNativePreviewController : UIViewController
@property(nonatomic, strong) NSURL *bundleURL;
@property(nonatomic, strong) RunWhaleNativePreviewDelegate *previewDelegate;
@property(nonatomic, strong) RunWhaleNativePreviewFactory *previewFactory;
@property(nonatomic, copy) NSString *sourceIdentifier;
@property(nonatomic, copy) NSString *projectIdentifier;
@property(nonatomic, strong) UIView *previewView;
@property(nonatomic, strong) UIButton *previewControl;
@property(nonatomic, strong) NSLayoutConstraint *previewControlTopConstraint;
@property(nonatomic, strong) NSLayoutConstraint *previewControlTrailingConstraint;
@property(nonatomic, strong) id contentObserver;
@property(nonatomic, copy) dispatch_block_t startupTimeoutBlock;
@property(nonatomic, strong) id<RCTComponentViewFactoryComponentProvider> previousComponentProvider;
@property(nonatomic, strong) NSMutableArray *readyHandlers;
@property(nonatomic, strong) NSMutableArray *failureHandlers;
@property(nonatomic, copy) NSString *lastFailureMessage;
@property(nonatomic, copy) RunWhaleNativePreviewActionHandler actionHandler;
@property(nonatomic, assign) BOOL ready;
@property(nonatomic, assign) BOOL failed;
@property(nonatomic, assign) BOOL crashed;
@property(atomic, assign) BOOL launchCancelled;
@property(nonatomic, assign) BOOL cancellationHandled;
- (void)cancelPendingLaunch;
@end

static __weak UIView *RunWhaleRegisteredNativePreviewHostView;
static __weak RunWhaleNativePreviewController *RunWhaleActiveNativePreviewController;

@implementation RunWhaleNativePreviewController

- (BOOL)usesChineseLabels {
  NSString *language = NSLocale.preferredLanguages.firstObject.lowercaseString;
  return [language hasPrefix:@"zh"];
}

- (instancetype)initWithBundleURL:(NSURL *)bundleURL
                  sourceIdentifier:(NSString *)sourceIdentifier
                 projectIdentifier:(NSString *)projectIdentifier
                      readyHandler:(RunWhaleNativePreviewReadyHandler)readyHandler
                    failureHandler:(RunWhaleNativePreviewFailureHandler)failureHandler
                      actionHandler:(RunWhaleNativePreviewActionHandler)actionHandler {
  if ((self = [super initWithNibName:nil bundle:nil])) {
    _bundleURL = bundleURL;
    _sourceIdentifier = [sourceIdentifier copy];
    _projectIdentifier = [projectIdentifier copy];
    _readyHandlers = [NSMutableArray new];
    _failureHandlers = [NSMutableArray new];
    [_readyHandlers addObject:[readyHandler copy]];
    [_failureHandlers addObject:[failureHandler copy]];
    _actionHandler = [actionHandler copy];
    self.modalPresentationStyle = UIModalPresentationFullScreen;
    [self scheduleStartupTimeout];
  }
  return self;
}

- (void)addReadyHandler:(RunWhaleNativePreviewReadyHandler)readyHandler
          failureHandler:(RunWhaleNativePreviewFailureHandler)failureHandler {
  if (self.ready) {
    dispatch_async(dispatch_get_main_queue(), readyHandler);
    return;
  }
  if (self.failed) {
    NSString *message = self.lastFailureMessage ?: @"Native Preview failed";
    dispatch_async(dispatch_get_main_queue(), ^{
      failureHandler(message);
    });
    return;
  }
  [self.readyHandlers addObject:[readyHandler copy]];
  [self.failureHandlers addObject:[failureHandler copy]];
}

- (void)viewDidLoad {
  [super viewDidLoad];
  self.view.backgroundColor = UIColor.systemBackgroundColor;
  if (self.launchCancelled) {
    [self cancelPendingLaunch];
    return;
  }

  __weak RunWhaleNativePreviewController *weakSelf = self;
  self.contentObserver = [NSNotificationCenter.defaultCenter addObserverForName:RCTContentDidAppearNotification
                                                                         object:nil
                                                                          queue:NSOperationQueue.mainQueue
                                                                     usingBlock:^(NSNotification *notification) {
                                                                       [weakSelf handleContentDidAppear:notification];
                                                                     }];

  @try {
    RCTComponentViewFactory *componentFactory = RCTComponentViewFactory.currentComponentViewFactory;
    self.previousComponentProvider = componentFactory.thirdPartyFabricComponentsProvider;

    self.previewDelegate = [RunWhaleNativePreviewDelegate new];
    self.previewDelegate.previewBundleURL = self.bundleURL;
    self.previewDelegate.dependencyProvider = [RunWhaleNativePreviewDependencyProvider new];
    self.previewFactory = [[RunWhaleNativePreviewFactory alloc] initWithDelegate:self.previewDelegate];
    self.previewFactory.projectIdentifier = self.projectIdentifier;
    RunWhaleNativePreviewRuntimeFailureHandler runtimeFailureHandler = ^(NSString *stage, NSString *code, NSString *message) {
      dispatch_async(dispatch_get_main_queue(), ^{
        [weakSelf handleRuntimeFailureAtStage:stage code:code message:message];
      });
    };
    self.previewFactory.runtimeFailureHandler = runtimeFailureHandler;

    UIView *preview = [self.previewFactory.rootViewFactory viewWithModuleName:@"main" initialProperties:@{}];
    preview.translatesAutoresizingMaskIntoConstraints = NO;
    preview.backgroundColor = UIColor.clearColor;
    self.previewView = preview;
    [self.view addSubview:preview];
    [NSLayoutConstraint activateConstraints:@[
      [preview.topAnchor constraintEqualToAnchor:self.view.topAnchor],
      [preview.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],
      [preview.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor],
      [preview.bottomAnchor constraintEqualToAnchor:self.view.bottomAnchor],
    ]];

    [self installMinimizeControl];
  } @catch (NSException *exception) {
    [self installMinimizeControl];
    [self handleRuntimeFailureAtStage:@"startup"
                                  code:@"native_startup_exception"
                               message:exception.reason ?: @"Native Preview could not initialize."];
  }
}

- (void)viewWillAppear:(BOOL)animated {
  [super viewWillAppear:animated];
  [self resetPreviewControlPosition];
  [self installRestrictedComponentProvider];
}

- (void)viewDidLayoutSubviews {
  [super viewDidLayoutSubviews];
  [self clampPreviewControlPosition];
}

- (void)viewDidDisappear:(BOOL)animated {
  [self restorePreviousComponentProvider];
  [super viewDidDisappear:animated];
}

- (UIButton *)previewControlWithImage:(NSString *)image
                                 label:(NSString *)label
                            identifier:(NSString *)identifier
                                action:(SEL)action {
  UIImageSymbolConfiguration *symbolConfiguration = [UIImageSymbolConfiguration configurationWithPointSize:20.0
                                                                                                      weight:UIImageSymbolWeightMedium];
  UIImage *controlImage = [UIImage systemImageNamed:image withConfiguration:symbolConfiguration];
  UIButton *control = [UIButton buttonWithConfiguration:RunWhalePreviewControlConfiguration(controlImage, NO)
                                           primaryAction:nil];
  control.translatesAutoresizingMaskIntoConstraints = NO;
  control.configurationUpdateHandler = ^(UIButton *button) {
    button.configuration = RunWhalePreviewControlConfiguration(controlImage, button.highlighted);
  };
  control.accessibilityLabel = label;
  control.accessibilityIdentifier = identifier;
  control.exclusiveTouch = YES;
  [control addTarget:self action:action forControlEvents:UIControlEventTouchUpInside];
  [control addGestureRecognizer:[[UIPanGestureRecognizer alloc] initWithTarget:self
                                                                        action:@selector(dragPreviewControl:)]];
  [NSLayoutConstraint activateConstraints:@[
    [control.widthAnchor constraintEqualToConstant:RunWhalePreviewControlSize],
    [control.heightAnchor constraintEqualToConstant:RunWhalePreviewControlSize],
  ]];
  return control;
}

- (void)installMinimizeControl {
  BOOL chinese = [self usesChineseLabels];
  UIButton *close = [self previewControlWithImage:@"xmark"
                                              label:chinese ? @"关闭 Preview" : @"Close Preview"
                                         identifier:@"runwhale-native-preview-back"
                                             action:@selector(minimizePreview)];
  self.previewControl = close;
  [self.view addSubview:close];

  UILayoutGuide *safe = self.view.safeAreaLayoutGuide;
  self.previewControlTopConstraint = [close.topAnchor constraintEqualToAnchor:safe.topAnchor
                                                                      constant:RunWhalePreviewControlGap];
  self.previewControlTrailingConstraint = [close.trailingAnchor constraintEqualToAnchor:safe.trailingAnchor
                                                                                constant:-RunWhalePreviewControlGap];
  [NSLayoutConstraint activateConstraints:@[
    self.previewControlTopConstraint,
    self.previewControlTrailingConstraint,
  ]];
}

- (void)resetPreviewControlPosition {
  self.previewControlTopConstraint.constant = RunWhalePreviewControlGap;
  self.previewControlTrailingConstraint.constant = -RunWhalePreviewControlGap;
}

- (void)clampPreviewControlPosition {
  if (self.previewControl == nil) return;
  CGSize safeSize = self.view.safeAreaLayoutGuide.layoutFrame.size;
  CGFloat maximumTop = MAX(RunWhalePreviewControlGap,
                           safeSize.height - RunWhalePreviewControlSize - RunWhalePreviewControlGap);
  CGFloat minimumTrailing = MIN(-RunWhalePreviewControlGap,
                                RunWhalePreviewControlSize + RunWhalePreviewControlGap - safeSize.width);
  self.previewControlTopConstraint.constant = MIN(maximumTop,
                                                  MAX(RunWhalePreviewControlGap,
                                                      self.previewControlTopConstraint.constant));
  self.previewControlTrailingConstraint.constant = MIN(-RunWhalePreviewControlGap,
                                                        MAX(minimumTrailing,
                                                            self.previewControlTrailingConstraint.constant));
}

- (void)dragPreviewControl:(UIPanGestureRecognizer *)gesture {
  if (gesture.state != UIGestureRecognizerStateChanged) return;
  CGPoint translation = [gesture translationInView:self.view];
  self.previewControlTopConstraint.constant += translation.y;
  self.previewControlTrailingConstraint.constant += translation.x;
  [gesture setTranslation:CGPointZero inView:self.view];
  [self clampPreviewControlPosition];
  [self.view layoutIfNeeded];
}

- (void)installRestrictedComponentProvider {
  if (self.previewFactory == nil) return;
  RCTComponentViewFactory *componentFactory = RCTComponentViewFactory.currentComponentViewFactory;
  if (componentFactory.thirdPartyFabricComponentsProvider != self.previewFactory) {
    self.previousComponentProvider = componentFactory.thirdPartyFabricComponentsProvider;
    componentFactory.thirdPartyFabricComponentsProvider = self.previewFactory;
  }
}

- (void)restorePreviousComponentProvider {
  if (self.previewFactory == nil) return;
  RCTComponentViewFactory *componentFactory = RCTComponentViewFactory.currentComponentViewFactory;
  if (componentFactory.thirdPartyFabricComponentsProvider == self.previewFactory) {
    componentFactory.thirdPartyFabricComponentsProvider = self.previousComponentProvider;
  }
}

- (void)handleContentDidAppear:(NSNotification *)notification {
  if (self.ready || self.failed || self.previewView == nil) return;
  UIView *content = [notification.object isKindOfClass:UIView.class] ? notification.object : nil;
  if (content == nil) return;

  BOOL belongsToPreview = content == self.previewView || [content isDescendantOfView:self.previewView];
  if (!belongsToPreview && [self.previewView isKindOfClass:RCTSurfaceHostingProxyRootView.class]) {
    UIView *surfaceView = ((RCTSurfaceHostingProxyRootView *)self.previewView).view;
    belongsToPreview = content == surfaceView || [content isDescendantOfView:surfaceView];
  }
  if (!belongsToPreview) return;
  [self completeFirstContentReadiness];
}

- (void)scheduleStartupTimeout {
  __weak RunWhaleNativePreviewController *weakSelf = self;
  dispatch_block_t block = dispatch_block_create(DISPATCH_BLOCK_INHERIT_QOS_CLASS, ^{
    [weakSelf handleRuntimeFailureAtStage:@"first-content"
                                     code:@"first_content_timeout"
                                  message:@"Native Preview did not mount content within 20 seconds."];
  });
  self.startupTimeoutBlock = block;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(RunWhaleNativePreviewStartupTimeout * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), block);
}

- (void)cancelStartupTimeout {
  if (self.startupTimeoutBlock != nil) dispatch_block_cancel(self.startupTimeoutBlock);
  self.startupTimeoutBlock = nil;
}

- (void)removeContentObserver {
  if (self.contentObserver == nil) return;
  [NSNotificationCenter.defaultCenter removeObserver:self.contentObserver];
  self.contentObserver = nil;
}

- (void)completeFirstContentReadiness {
  if (self.ready || self.failed || self.launchCancelled) return;
  self.ready = YES;
  [self cancelStartupTimeout];
  [self removeContentObserver];
  NSArray *handlers = [self.readyHandlers copy];
  [self.readyHandlers removeAllObjects];
  [self.failureHandlers removeAllObjects];
  for (RunWhaleNativePreviewReadyHandler handler in handlers) handler();
}

- (void)handleRuntimeFailureAtStage:(NSString *)stage code:(NSString *)code message:(NSString *)message {
  if (self.launchCancelled) {
    [self cancelPendingLaunch];
    return;
  }
  if (self.crashed) return;
  BOOL failedAfterReady = self.ready;
  self.crashed = YES;
  self.failed = YES;
  self.lastFailureMessage = RunWhaleRecordNativePreviewDiagnostic(stage, code, message);
  [self cancelStartupTimeout];
  [self removeContentObserver];

  NSArray *handlers = [self.failureHandlers copy];
  [self.readyHandlers removeAllObjects];
  [self.failureHandlers removeAllObjects];
  if (failedAfterReady && self.actionHandler != nil) {
    self.actionHandler(@"failure", self.lastFailureMessage);
  } else if (!failedAfterReady) {
    for (RunWhaleNativePreviewFailureHandler handler in handlers) handler(self.lastFailureMessage);
  }

  [self tearDownPreviewRuntime];

  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.2 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    [self closePreview];
  });
}

- (void)cancelPendingLaunch {
  if (self.cancellationHandled) return;
  self.cancellationHandled = YES;
  self.launchCancelled = YES;
  self.crashed = YES;
  self.failed = YES;
  [self cancelStartupTimeout];
  [self removeContentObserver];

  NSArray *handlers = [self.failureHandlers copy];
  [self.readyHandlers removeAllObjects];
  [self.failureHandlers removeAllObjects];
  for (RunWhaleNativePreviewFailureHandler handler in handlers) {
    handler(@"Native Preview launch was cancelled.");
  }

  [self tearDownPreviewRuntime];
  [self closePreview];
}

- (void)minimizePreview {
  if (!self.ready && !self.failed) {
    [self handleRuntimeFailureAtStage:@"presentation"
                                 code:@"startup_cancelled"
                              message:@"Native Preview was minimized before content mounted."];
    return;
  }
  [self closePreview];
}

- (void)closePreview {
  if (self.parentViewController != nil) {
    RunWhaleDetachNativePreviewController(self);
    RunWhaleRestoreStudioStatusBar();
  } else {
    [self dismissViewControllerAnimated:YES completion:^{
      RunWhaleRestoreStudioStatusBar();
    }];
  }
}

- (void)tearDownPreviewRuntime {
  NSCAssert(NSThread.isMainThread, @"Native Preview runtimes must be torn down on the main thread");
  RunWhaleNativePreviewFactory *factory = self.previewFactory;
  RunWhaleNativePreviewDelegate *delegate = self.previewDelegate;
  UIView *preview = self.previewView;

  [self restorePreviousComponentProvider];
  factory.runtimeFailureHandler = nil;

  // Stop the surface and suspend its presenter while the Preview AppContext is
  // still alive. Fabric may already have mounting work queued on the main
  // thread; retaining this runtime through the next queue turn lets that work
  // drain without dereferencing an AppContext that teardown just released.
  if ([preview isKindOfClass:RCTSurfaceHostingProxyRootView.class]) {
    [((RCTSurfaceHostingProxyRootView *)preview).surface stop];
  }
  [factory.rootViewFactory.reactHost.surfacePresenter suspend];
  [preview removeFromSuperview];
  self.previewView = nil;
  self.previewFactory = nil;
  self.previewDelegate = nil;

  if (factory != nil || delegate != nil || preview != nil) {
    NSArray *retiredRuntime = @[
      factory ?: NSNull.null,
      delegate ?: NSNull.null,
      preview ?: NSNull.null,
    ];
    dispatch_async(dispatch_get_main_queue(), ^{
      (void)retiredRuntime.count;
    });
  }
}

- (void)dealloc {
  [self cancelStartupTimeout];
  [self removeContentObserver];
  [self tearDownPreviewRuntime];
}

@end

static UIViewController *_Nullable RunWhaleOwningViewController(UIView *view) {
  UIResponder *responder = view;
  while ((responder = responder.nextResponder)) {
    if ([responder isKindOfClass:UIViewController.class]) return (UIViewController *)responder;
  }
  return nil;
}

void RunWhaleDetachNativePreviewController(UIViewController *controller) {
  NSCAssert(NSThread.isMainThread, @"Native Preview controllers must be detached on the main thread");
  if (![controller isKindOfClass:RunWhaleNativePreviewController.class]) return;
  RunWhaleNativePreviewController *previewController = (RunWhaleNativePreviewController *)controller;
  if (previewController.parentViewController == nil) return;

  [previewController beginAppearanceTransition:NO animated:NO];
  [previewController willMoveToParentViewController:nil];
  [previewController.view removeFromSuperview];
  [previewController removeFromParentViewController];
  [previewController endAppearanceTransition];
  previewController.previewControl.hidden = NO;
}

static BOOL RunWhaleEmbedNativePreviewController(
    RunWhaleNativePreviewController *controller,
    UIView *hostView) {
  if (controller.crashed || controller.launchCancelled || hostView.window == nil) return NO;
  UIViewController *parent = RunWhaleOwningViewController(hostView);
  if (parent == nil || parent == controller || controller.presentingViewController != nil) return NO;
  if (controller.parentViewController == parent && controller.view.superview == hostView) return YES;

  RunWhaleDetachNativePreviewController(controller);
  [parent addChildViewController:controller];
  [controller beginAppearanceTransition:YES animated:NO];
  UIView *preview = controller.view;
  preview.translatesAutoresizingMaskIntoConstraints = NO;
  hostView.clipsToBounds = YES;
  [hostView addSubview:preview];
  [NSLayoutConstraint activateConstraints:@[
    [preview.topAnchor constraintEqualToAnchor:hostView.topAnchor],
    [preview.leadingAnchor constraintEqualToAnchor:hostView.leadingAnchor],
    [preview.trailingAnchor constraintEqualToAnchor:hostView.trailingAnchor],
    [preview.bottomAnchor constraintEqualToAnchor:hostView.bottomAnchor],
  ]];
  [controller didMoveToParentViewController:parent];
  [controller endAppearanceTransition];
  controller.previewControl.hidden = YES;
  return YES;
}

void RunWhaleSetNativePreviewHostView(UIView *hostView) {
  NSCAssert(NSThread.isMainThread, @"Native Preview hosts must be registered on the main thread");
  RunWhaleRegisteredNativePreviewHostView = hostView;
  RunWhaleNativePreviewController *controller = RunWhaleActiveNativePreviewController;
  if (controller != nil) RunWhaleEmbedNativePreviewController(controller, hostView);
}

void RunWhaleClearNativePreviewHostView(UIView *hostView) {
  NSCAssert(NSThread.isMainThread, @"Native Preview hosts must be cleared on the main thread");
  if (RunWhaleRegisteredNativePreviewHostView != hostView) return;
  RunWhaleNativePreviewController *controller = RunWhaleActiveNativePreviewController;
  if (controller != nil && controller.view.superview == hostView) {
    RunWhaleDetachNativePreviewController(controller);
    RunWhaleRestoreStudioStatusBar();
  }
  RunWhaleRegisteredNativePreviewHostView = nil;
}

void RunWhalePresentNativePreviewController(
    UIViewController *controller,
    UIViewController *fallbackPresenter) {
  NSCAssert(NSThread.isMainThread, @"Native Preview controllers must be presented on the main thread");
  if (![controller isKindOfClass:RunWhaleNativePreviewController.class]) return;
  RunWhaleNativePreviewController *previewController = (RunWhaleNativePreviewController *)controller;
  if (previewController.launchCancelled) return;
  RunWhaleNativePreviewController *previous = RunWhaleActiveNativePreviewController;
  RunWhaleActiveNativePreviewController = previewController;
  if (previous != nil && previous != previewController) {
    UIViewController *presenter = previous.presentingViewController;
    if (presenter != nil) {
      // A new bundle replaces the visible Preview. Presenting from the current
      // top controller would stack it over the old Preview and require two closes.
      [previous dismissViewControllerAnimated:NO completion:^{
        if (RunWhaleActiveNativePreviewController != previewController || previewController.launchCancelled) return;
        RunWhalePresentNativePreviewController(previewController, presenter);
      }];
      return;
    }
    RunWhaleDetachNativePreviewController(previous);
  }

  UIView *hostView = RunWhaleRegisteredNativePreviewHostView;
  if (hostView != nil && RunWhaleEmbedNativePreviewController(previewController, hostView)) return;
  previewController.previewControl.hidden = NO;
  if (fallbackPresenter != previewController && previewController.presentingViewController == nil) {
    [fallbackPresenter presentViewController:previewController animated:YES completion:nil];
  }
}

UIViewController *RunWhaleCreateNativePreviewController(
    NSURL *bundleURL,
    NSString *sourceIdentifier,
    NSString *projectIdentifier,
    RunWhaleNativePreviewReadyHandler readyHandler,
    RunWhaleNativePreviewFailureHandler failureHandler,
    RunWhaleNativePreviewActionHandler actionHandler) {
  NSCAssert(NSThread.isMainThread, @"Native Preview controllers must be created on the main thread");
  [NSUserDefaults.standardUserDefaults removeObjectForKey:RunWhaleNativePreviewDiagnosticKey];

  static RunWhaleNativePreviewController *controller;
  if (controller == nil
      || controller.crashed
      || controller.launchCancelled
      || ![controller.sourceIdentifier isEqualToString:sourceIdentifier]
      || ![controller.projectIdentifier isEqualToString:projectIdentifier]) {
    controller = [[RunWhaleNativePreviewController alloc] initWithBundleURL:bundleURL
                                                            sourceIdentifier:sourceIdentifier
                                                           projectIdentifier:projectIdentifier
                                                                readyHandler:readyHandler
                                                              failureHandler:failureHandler
                                                                actionHandler:actionHandler];
  } else {
    controller.actionHandler = [actionHandler copy];
    [controller addReadyHandler:readyHandler failureHandler:failureHandler];
  }
  return controller;
}

void RunWhaleCancelNativePreviewController(UIViewController *controller) {
  if (![controller isKindOfClass:RunWhaleNativePreviewController.class]) return;
  RunWhaleNativePreviewController *previewController = (RunWhaleNativePreviewController *)controller;
  previewController.launchCancelled = YES;
  dispatch_block_t cancel = ^{
    [previewController cancelPendingLaunch];
  };
  if (NSThread.isMainThread) {
    cancel();
  } else {
    dispatch_async(dispatch_get_main_queue(), cancel);
  }
}
