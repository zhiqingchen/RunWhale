#import "NativePreviewPolicy.h"

__attribute__((weak)) Class RunWhalePreviewModuleClass(const char *name) {
  return Nil;
}

__attribute__((weak)) NSArray<id<RCTBridgeModule>> *RunWhalePreviewExtraModules(RCTBridge *bridge) {
  return @[];
}
