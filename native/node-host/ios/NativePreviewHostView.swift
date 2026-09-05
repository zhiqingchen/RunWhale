import ExpoModulesCore
import UIKit

public final class NativePreviewHostView: ExpoView {
  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      RunWhaleClearNativePreviewHostView(self)
    } else {
      RunWhaleSetNativePreviewHostView(self)
    }
  }

  deinit {
    RunWhaleClearNativePreviewHostView(self)
  }
}
