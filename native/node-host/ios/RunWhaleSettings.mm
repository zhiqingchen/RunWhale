#import "RunWhaleSettings.h"
#import "NativePreviewBridge.h"

static NSString *RunWhaleLanguage;
static NSString *RunWhaleClosePreviewLabel;
static NSString *const RunWhaleLanguageChanged = @"runwhaleLanguageChanged";

BOOL RunWhaleSetLanguage(NSString *language, NSString *closePreviewLabel) {
  if (![@[@"en", @"zh-CN", @"es", @"fr", @"ja"] containsObject:language]) return NO;
  @synchronized(RunWhaleSettings.class) {
    RunWhaleClosePreviewLabel = [closePreviewLabel copy];
    if ([RunWhaleLanguage isEqualToString:language]) return YES;
    RunWhaleLanguage = [language copy];
  }
  [NSNotificationCenter.defaultCenter postNotificationName:RunWhaleLanguageChanged object:nil];
  return YES;
}

@implementation RunWhaleSettings
RCT_EXPORT_MODULE(RunWhaleSettings)
+ (BOOL)requiresMainQueueSetup { return NO; }
+ (NSString *)closePreviewLabel {
  @synchronized(RunWhaleSettings.class) { return RunWhaleClosePreviewLabel ?: @"Close Preview"; }
}
- (NSArray<NSString *> *)supportedEvents { return @[RunWhaleLanguageChanged]; }
RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(getLanguage) {
  @synchronized(RunWhaleSettings.class) { return (id)RunWhaleLanguage ?: NSNull.null; }
}
- (void)startObserving {
  [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(languageChanged:)
                                            name:RunWhaleLanguageChanged object:nil];
}
- (void)stopObserving { [NSNotificationCenter.defaultCenter removeObserver:self]; }
- (void)languageChanged:(NSNotification *)notification {
  [self sendEventWithName:RunWhaleLanguageChanged body:nil];
}
@end
