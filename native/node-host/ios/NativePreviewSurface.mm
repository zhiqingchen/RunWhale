#import "NativePreviewSurface.h"

#import <React/RCTFabricSurface.h>
#import <React/RCTMountingManager.h>
#import <React/RCTSurfaceDelegate.h>
#import <React/RCTSurfacePresenter.h>
#import <React/RCTSurfaceView.h>
#import <React/RCTUtils.h>
#import <objc/runtime.h>

static const void *RunWhalePreviewPresenterKey = &RunWhalePreviewPresenterKey;

@interface RunWhaleNativePreviewSurface : RCTFabricSurface
@property(nonatomic, weak) RCTSurfacePresenter *previewPresenter;
@property(nonatomic, assign) BOOL stopped;
@property(atomic, assign) NSUInteger generation;
@end

@implementation RunWhaleNativePreviewSurface

- (void)start {
  NSUInteger generation = self.generation;
  // RN 0.86 checks Registered before queuing SurfaceHandler::start on a
  // background queue. Teardown can unregister the surface between those steps.
  // Keep the check, attachment and start in the same main-queue operation as
  // Preview teardown. The host still requests start only after bundle execution.
  RCTExecuteOnMainQueue(^{
    if (generation != self.generation || self.stopped
        || self.surfaceHandler.getStatus() != facebook::react::SurfaceHandler::Status::Registered) return;
    RCTSurfacePresenter *presenter = self.previewPresenter;
    if (presenter == nil) return;
    [presenter.mountingManager attachSurfaceToView:self.view surfaceId:self.surfaceHandler.getSurfaceId()];
    self.surfaceHandler.start();
    [presenter setupAnimationDriverWithSurfaceHandler:self.surfaceHandler];
    id<RCTSurfaceDelegate> delegate = self.delegate;
    if ([delegate respondsToSelector:@selector(surface:didChangeStage:)]) {
      [delegate surface:(RCTSurface *)self didChangeStage:self.stage];
    }
  });
}

- (void)stop {
  // Presenter suspension must finish stopping before unregistering the handler.
  if (!NSThread.isMainThread) {
    dispatch_sync(dispatch_get_main_queue(), ^{ [self stop]; });
    return;
  }
  self.stopped = YES;
  self.generation += 1;
  [super stop];
}

- (void)resetWithSurfacePresenter:(RCTSurfacePresenter *)presenter {
  if (!NSThread.isMainThread) {
    dispatch_sync(dispatch_get_main_queue(), ^{ [self resetWithSurfacePresenter:presenter]; });
    return;
  }
  self.previewPresenter = presenter;
  self.stopped = NO;
  self.generation += 1;
  [super resetWithSurfacePresenter:presenter];
}

@end

@interface RCTFabricSurface (RunWhalePreview)
- (instancetype)runwhale_initWithSurfacePresenter:(RCTSurfacePresenter *)presenter
                                      moduleName:(NSString *)moduleName
                               initialProperties:(NSDictionary *)properties __attribute__((objc_method_family(init)));
@end

@implementation RCTFabricSurface (RunWhalePreview)

- (instancetype)runwhale_initWithSurfacePresenter:(RCTSurfacePresenter *)presenter
                                      moduleName:(NSString *)moduleName
                               initialProperties:(NSDictionary *)properties {
  // RCTHost constructs RCTFabricSurface directly, including with prebuilt React.
  // Substitute only Preview surfaces, before the host can schedule their start.
  if (self.class == RCTFabricSurface.class && objc_getAssociatedObject(presenter, RunWhalePreviewPresenterKey)) {
    self = [RunWhaleNativePreviewSurface alloc];
  }
  self = [self runwhale_initWithSurfacePresenter:presenter moduleName:moduleName initialProperties:properties];
  if ([self isKindOfClass:RunWhaleNativePreviewSurface.class]) {
    ((RunWhaleNativePreviewSurface *)self).previewPresenter = presenter;
  }
  return self;
}

@end

void RunWhaleConfigureNativePreviewSurfaces(RCTSurfacePresenter *presenter) {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    method_exchangeImplementations(
        class_getInstanceMethod(RCTFabricSurface.class, @selector(initWithSurfacePresenter:moduleName:initialProperties:)),
        class_getInstanceMethod(RCTFabricSurface.class, @selector(runwhale_initWithSurfacePresenter:moduleName:initialProperties:)));
  });
  objc_setAssociatedObject(presenter, RunWhalePreviewPresenterKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}
