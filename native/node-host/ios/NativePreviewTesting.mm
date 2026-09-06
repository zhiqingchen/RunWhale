#import "NativePreviewTesting.h"
#import <React/RCTTouchableComponentViewProtocol.h>
#import <WebKit/WebKit.h>
#import <react/renderer/components/view/TouchEventEmitter.h>
#import <react/timing/primitives.h>

static NSString *RWTestResult(NSDictionary *value) {
  NSMutableDictionary *result = [value mutableCopy];
  result[@"timestamp"] = @(NSDate.date.timeIntervalSince1970 * 1000);
  NSData *data = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
  return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}
static NSString *RWTestFailure(NSString *message) { return RWTestResult(@{@"error": message}); }
static NSString *RWTestText(NSString *text) { return text.length > 512 ? [text substringToIndex:512] : text ?: @""; }
static NSDictionary *RWViewport(UIView *view) { return @{@"width": @(view.bounds.size.width), @"height": @(view.bounds.size.height), @"scale": @(view.window.screen.scale)}; }

static NSString *RWTestImage(UIImage *image, NSDictionary *viewport) {
  if (!image) return RWTestFailure(@"Preview screenshot could not be captured");
  CGFloat ratio = MIN(1, 1280 / MAX(image.size.width * image.scale, image.size.height * image.scale));
  CGSize size = CGSizeMake(MAX(1, floor(image.size.width * image.scale * ratio)), MAX(1, floor(image.size.height * image.scale * ratio)));
  UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat defaultFormat];
  format.scale = 1;
  UIImage *scaled = [[[UIGraphicsImageRenderer alloc] initWithSize:size format:format] imageWithActions:^(UIGraphicsImageRendererContext *context) {
    [image drawInRect:(CGRect){CGPointZero, size}];
  }];
  NSData *data = UIImageJPEGRepresentation(scaled, 0.7);
  if (!data || data.length > 340000) return RWTestFailure(@"Preview screenshot exceeds the image limit");
  return RWTestResult(@{@"viewport": viewport, @"image": @{@"mediaType": @"image/jpeg", @"base64": [data base64EncodedStringWithOptions:0], @"width": @(size.width), @"height": @(size.height)}});
}

@implementation RunWhalePreviewTesting {
  NSMutableArray<NSDictionary *> *_logs;
  NSUInteger _sequence;
  NSString *_snapshotId;
  NSMapTable<NSString *, UIView *> *_targets;
  NSMutableDictionary<NSString *, NSDictionary *> *_descriptions;
}

- (instancetype)init {
  if ((self = [super init])) {
    _logs = [NSMutableArray new];
    _targets = [NSMapTable strongToWeakObjectsMapTable];
    _descriptions = [NSMutableDictionary new];
  }
  return self;
}

- (void)logLevel:(NSString *)level message:(NSString *)message {
  @synchronized(self) {
    NSString *selected = [@[@"debug", @"info", @"warn", @"error"] containsObject:level] ? level : @"info";
    [_logs addObject:@{@"sequence": @(++_sequence), @"timestamp": @(NSDate.date.timeIntervalSince1970 * 1000), @"level": selected, @"message": message.length > 1024 ? [message substringToIndex:1024] : message}];
    if (_logs.count > 100) [_logs removeObjectAtIndex:0];
  }
}

- (NSDictionary *)describe:(UIView *)view {
  UIView *root = self.root;
  CGRect bounds = [view convertRect:view.bounds toView:root];
  BOOL visible = view.window != nil && CGRectIntersectsRect(bounds, root.bounds) && bounds.size.width > 0 && bounds.size.height > 0;
  for (UIView *ancestor = view; ancestor != nil; ancestor = ancestor.superview) if (ancestor.hidden || ancestor.alpha < 0.01) visible = NO;
  UIAccessibilityTraits traits = view.accessibilityTraits;
  BOOL enabled = !(traits & UIAccessibilityTraitNotEnabled) && (![view isKindOfClass:UIControl.class] || ((UIControl *)view).enabled);
  NSString *role = (traits & UIAccessibilityTraitButton) ? @"button" : (traits & UIAccessibilityTraitLink) ? @"link" : (traits & UIAccessibilityTraitImage) ? @"image" : NSStringFromClass(view.class);
  NSString *text = [view isKindOfClass:UILabel.class] ? ((UILabel *)view).text : @"";
  NSString *value = view.accessibilityValue;
  NSMutableArray *actions = [NSMutableArray new];
  if (enabled && view.userInteractionEnabled && ([view isKindOfClass:UIControl.class] || (traits & (UIAccessibilityTraitButton | UIAccessibilityTraitLink)))) [actions addObject:@"press"];
  if ([view isKindOfClass:UITextField.class]) {
    UITextField *field = (UITextField *)view;
    role = @"textbox"; value = field.secureTextEntry ? @"" : field.text;
    if (enabled && !field.secureTextEntry) [actions addObject:@"fill"];
  } else if ([view isKindOfClass:UITextView.class]) {
    UITextView *field = (UITextView *)view;
    role = @"textbox"; value = field.secureTextEntry ? @"" : field.text;
    if (enabled && field.editable && !field.secureTextEntry) [actions addObject:@"fill"];
  }
  if (enabled && [view isKindOfClass:UIScrollView.class] && ((UIScrollView *)view).scrollEnabled) [actions addObject:@"scroll"];
  return @{@"role": role, @"text": RWTestText(text), @"label": RWTestText(view.accessibilityLabel), @"value": RWTestText(value), @"testId": RWTestText(view.accessibilityIdentifier), @"bounds": @{@"x": @(bounds.origin.x), @"y": @(bounds.origin.y), @"width": @(bounds.size.width), @"height": @(bounds.size.height)}, @"visible": @(visible), @"enabled": @(enabled), @"selected": @((traits & UIAccessibilityTraitSelected) != 0), @"actions": actions};
}

- (NSString *)execute:(NSString *)command {
  NSAssert(NSThread.isMainThread, @"Preview testing must run on the main thread");
  UIView *root = self.root;
  if (!root.window || root.hidden) return RWTestFailure(@"Keep the Native Preview visible while testing");
  NSDictionary *request = [NSJSONSerialization JSONObjectWithData:[command dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
  if (![request isKindOfClass:NSDictionary.class]) return RWTestFailure(@"Invalid Preview test command");
  NSString *kind = request[@"kind"];
  if ([kind isEqual:@"logs"]) {
    @synchronized(self) {
      NSUInteger after = [request[@"afterSequence"] unsignedIntegerValue];
      NSMutableArray *entries = [NSMutableArray new];
      for (NSDictionary *entry in _logs) if ([entry[@"sequence"] unsignedIntegerValue] > after) [entries addObject:entry];
      return RWTestResult(@{@"logs": entries, @"nextSequence": @(_sequence), @"gap": @(_logs.count > 0 && after + 1 < [_logs.firstObject[@"sequence"] unsignedIntegerValue])});
    }
  }
  if ([kind isEqual:@"screenshot"]) {
    if (root.bounds.size.width <= 0 || root.bounds.size.height <= 0) return RWTestFailure(@"Preview has no visible content");
    UIGraphicsImageRendererFormat *format = [UIGraphicsImageRendererFormat defaultFormat];
    format.scale = MIN(root.window.screen.scale, 1280 / MAX(root.bounds.size.width, root.bounds.size.height));
    __block BOOL drawn = NO;
    UIImage *image = [[[UIGraphicsImageRenderer alloc] initWithSize:root.bounds.size format:format] imageWithActions:^(UIGraphicsImageRendererContext *context) {
      drawn = [root drawViewHierarchyInRect:root.bounds afterScreenUpdates:YES];
    }];
    return drawn ? RWTestImage(image, RWViewport(root)) : RWTestFailure(@"Preview hierarchy could not be drawn");
  }
  if ([kind isEqual:@"inspect"]) {
    [_targets removeAllObjects]; [_descriptions removeAllObjects];
    _snapshotId = NSUUID.UUID.UUIDString;
    NSMutableArray *nodes = [NSMutableArray new];
    NSMutableArray *queue = [NSMutableArray arrayWithObject:@{@"view": root}];
    while (queue.count > 0 && nodes.count < 250) {
      NSDictionary *item = queue.firstObject; [queue removeObjectAtIndex:0];
      UIView *view = item[@"view"];
      NSString *nodeId = [NSString stringWithFormat:@"n%lu", (unsigned long)nodes.count + 1];
      NSDictionary *description = [self describe:view];
      NSMutableDictionary *node = [description mutableCopy]; node[@"id"] = nodeId;
      if (item[@"parentId"]) node[@"parentId"] = item[@"parentId"];
      [nodes addObject:node]; [_targets setObject:view forKey:nodeId]; _descriptions[nodeId] = description;
      if (![view isKindOfClass:WKWebView.class]) for (UIView *child in view.subviews) [queue addObject:@{@"view": child, @"parentId": nodeId}];
    }
    return RWTestResult(@{@"snapshotId": _snapshotId, @"nodes": nodes, @"truncated": @(queue.count > 0), @"viewport": RWViewport(root)});
  }
  if (![kind isEqual:@"action"]) return RWTestFailure(@"Unsupported Preview test command");
  NSString *nodeId = request[@"nodeId"];
  if (![_snapshotId isEqual:request[@"snapshotId"]]) return RWTestFailure(@"The node snapshot is stale. Inspect again.");
  UIView *view = [_targets objectForKey:nodeId];
  if (!view || ![view isDescendantOfView:root]) return RWTestFailure(@"The target was removed. Inspect again.");
  NSDictionary *description = [self describe:view];
  if (![description isEqual:_descriptions[nodeId]] || ![description[@"visible"] boolValue]) return RWTestFailure(@"The target changed. Inspect again.");
  NSString *action = request[@"action"];
  if (![description[@"actions"] containsObject:action]) return RWTestFailure(@"This node does not support that action");
  _snapshotId = nil;
  if ([action isEqual:@"fill"]) {
    NSString *text = request[@"text"];
    if (![text isKindOfClass:NSString.class] || text.length > 4096) return RWTestFailure(@"fill requires bounded text");
    [view becomeFirstResponder];
    id<UITextInput> input = (id<UITextInput>)view;
    input.selectedTextRange = [input textRangeFromPosition:input.beginningOfDocument toPosition:input.endOfDocument];
    [(id<UIKeyInput>)view insertText:text];
  } else if ([action isEqual:@"scroll"]) {
    NSString *direction = request[@"direction"];
    if (![@[@"up", @"down"] containsObject:direction]) return RWTestFailure(@"scroll requires up or down");
    UIScrollView *scroll = (UIScrollView *)view;
    CGFloat y = scroll.contentOffset.y + ([direction isEqual:@"up"] ? -1 : 1) * scroll.bounds.size.height * 0.75;
    y = MAX(-scroll.adjustedContentInset.top, MIN(y, MAX(-scroll.adjustedContentInset.top, scroll.contentSize.height - scroll.bounds.size.height + scroll.adjustedContentInset.bottom)));
    [scroll setContentOffset:CGPointMake(scroll.contentOffset.x, y) animated:NO];
  } else {
    CGPoint point = CGPointMake(CGRectGetMidX(view.bounds), CGRectGetMidY(view.bounds));
    CGPoint rootPoint = [view convertPoint:point toView:root];
    UIView *hit = [root hitTest:rootPoint withEvent:nil];
    if (!hit || (hit != view && ![hit isDescendantOfView:view])) return RWTestFailure(@"The target is covered by another view");
    if ([view isKindOfClass:UIControl.class]) [(UIControl *)view sendActionsForControlEvents:UIControlEventTouchUpInside];
    else if ([view respondsToSelector:@selector(touchEventEmitterAtPoint:)]) {
      auto emitter = [(id<RCTTouchableComponentViewProtocol>)view touchEventEmitterAtPoint:point];
      if (!emitter) return RWTestFailure(@"This native view has no React touch event emitter");
      facebook::react::Touch touch = {};
      touch.target = (facebook::react::Tag)view.tag;
      touch.offsetPoint = {point.x, point.y}; touch.pagePoint = {rootPoint.x, rootPoint.y};
      CGPoint screen = [view convertPoint:point toView:nil]; touch.screenPoint = {screen.x, screen.y};
      touch.timestamp = NSProcessInfo.processInfo.systemUptime;
      touch.timeStamp = facebook::react::HighResTimeStamp::fromDOMHighResTimeStamp(touch.timestamp * 1000);
      facebook::react::TouchEvent event = {};
      event.touches.insert(touch); event.changedTouches.insert(touch); event.targetTouches.insert(touch);
      emitter->onTouchStart(event);
      event.touches.clear(); event.targetTouches.clear(); emitter->onTouchEnd(event);
    } else return RWTestFailure(@"This native control does not support a press adapter");
  }
  return RWTestResult(@{@"performed": @YES, @"method": @"native-view-event"});
}
@end

static WKWebView *RWFindWebView(UIView *view) {
  if ([view isKindOfClass:WKWebView.class]) return (WKWebView *)view;
  for (UIView *child in view.subviews) { WKWebView *found = RWFindWebView(child); if (found) return found; }
  return nil;
}
void RunWhaleCaptureWebPreview(NSNumber *viewTag, void (^completion)(NSString *)) {
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (![scene isKindOfClass:UIWindowScene.class]) continue;
    for (UIWindow *window in ((UIWindowScene *)scene).windows) {
      UIView *target = [window viewWithTag:viewTag.integerValue];
      WKWebView *web = target ? RWFindWebView(target) : nil;
      if (!web || web.hidden || ![web.URL.host isEqual:@"127.0.0.1"]) continue;
      WKSnapshotConfiguration *configuration = [WKSnapshotConfiguration new];
      configuration.snapshotWidth = @(MIN(1280, web.bounds.size.width * web.window.screen.scale));
      [web takeSnapshotWithConfiguration:configuration completionHandler:^(UIImage *image, NSError *error) {
        completion(error ? RWTestFailure(@"Web Preview screenshot failed") : RWTestImage(image, RWViewport(web)));
      }];
      return;
    }
  }
  completion(RWTestFailure(@"Web Preview is not mounted"));
}
