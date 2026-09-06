#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface RunWhalePreviewTesting : NSObject
@property(nonatomic, weak, nullable) UIView *root;
- (void)logLevel:(NSString *)level message:(NSString *)message;
- (NSString *)execute:(NSString *)command;
@end

FOUNDATION_EXPORT void RunWhaleCaptureWebPreview(NSNumber *viewTag, void (^completion)(NSString *result));
NS_ASSUME_NONNULL_END
