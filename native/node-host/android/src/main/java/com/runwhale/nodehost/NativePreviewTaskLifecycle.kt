package com.runwhale.nodehost

import android.content.Intent

internal object NativePreviewTaskLifecycle {
  const val LAUNCH_FLAGS = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP

  fun minimize(moveTaskToBack: (Boolean) -> Boolean, finish: () -> Unit) {
    if (!moveTaskToBack(true)) finish()
  }
}
