#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^RunWhaleNativePreviewReadyHandler)(void);
typedef void (^RunWhaleNativePreviewFailureHandler)(NSString *message);
typedef void (^RunWhaleNativePreviewActionHandler)(NSString *action, NSString *_Nullable message);

FOUNDATION_EXPORT UIViewController *RunWhaleCreateNativePreviewController(
    NSURL *bundleURL,
    NSString *sourceIdentifier,
    NSString *projectIdentifier,
    RunWhaleNativePreviewReadyHandler readyHandler,
    RunWhaleNativePreviewFailureHandler failureHandler,
    RunWhaleNativePreviewActionHandler actionHandler);
FOUNDATION_EXPORT void RunWhalePresentNativePreviewController(
    UIViewController *controller,
    UIViewController *fallbackPresenter);
FOUNDATION_EXPORT void RunWhaleDetachNativePreviewController(UIViewController *controller);
FOUNDATION_EXPORT void RunWhaleSetNativePreviewHostView(UIView *hostView);
FOUNDATION_EXPORT void RunWhaleClearNativePreviewHostView(UIView *hostView);
FOUNDATION_EXPORT void RunWhaleCancelNativePreviewController(UIViewController *controller);
FOUNDATION_EXPORT NSString *RunWhaleRecordNativePreviewDiagnostic(
    NSString *stage, NSString *code, NSString *message);
FOUNDATION_EXPORT NSString *_Nullable RunWhaleTakeNativePreviewDiagnostic(void);

NS_ASSUME_NONNULL_END
