package com.runwhale.nodehost

import android.content.Intent
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativePreviewTaskLifecycleTest {
  @Test
  fun `launches Preview in its reusable task without clearing it`() {
    val flags = NativePreviewTaskLifecycle.LAUNCH_FLAGS

    assertTrue(flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
    assertTrue(flags and Intent.FLAG_ACTIVITY_SINGLE_TOP != 0)
    assertEquals(0, flags and Intent.FLAG_ACTIVITY_CLEAR_TOP)
    assertEquals(0, flags and Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
  }

  @Test
  fun `minimize backgrounds the Preview task without finishing its Activity`() {
    var rootOnly: Boolean? = null
    var finished = false

    NativePreviewTaskLifecycle.minimize(
      moveTaskToBack = { root -> rootOnly = root; true },
      finish = { finished = true },
    )

    assertEquals(true, rootOnly)
    assertFalse(finished)
  }

  @Test
  fun `minimize finishes only when Android cannot background the Preview task`() {
    var finished = false

    NativePreviewTaskLifecycle.minimize(
      moveTaskToBack = { false },
      finish = { finished = true },
    )

    assertTrue(finished)
  }

  @Test
  fun `manifest isolates one hidden single-task Preview Activity`() {
    val manifest = File("src/main/AndroidManifest.xml").readText()
    val declaration = manifest
      .substringAfter("android:name=\"com.runwhale.nodehost.NativePreviewActivity\"")
      .substringBefore("/>")

    assertTrue(declaration.contains("android:launchMode=\"singleTask\""))
    assertTrue(declaration.contains("android:taskAffinity=\"\${applicationId}.nativePreview\""))
    assertTrue(declaration.contains("android:excludeFromRecents=\"true\""))
    assertTrue(declaration.contains("android:exported=\"false\""))
  }

  @Test
  fun `Preview host provides the AppCompat Activity required by Expo modules`() {
    val activity = File("src/main/java/com/runwhale/nodehost/NativePreviewActivity.kt").readText()
    val manifest = File("src/main/AndroidManifest.xml").readText()
    val styles = File("src/main/res/values/styles.xml").readText()

    assertTrue(activity.contains("class NativePreviewActivity : AppCompatActivity()"))
    assertTrue(manifest.contains("android:theme=\"@style/RunWhaleNativePreviewTheme\""))
    assertTrue(styles.contains("parent=\"Theme.AppCompat.DayNight.NoActionBar\""))
  }

  @Test
  fun `stock emulator cleartext is limited to the debug network policy`() {
    val mainPolicy = File("src/main/res/xml/runwhale_network_security_config.xml").readText()
    val debugPolicy = File("src/debug/res/xml/runwhale_network_security_config.xml").readText()

    assertTrue(mainPolicy.contains("cleartextTrafficPermitted=\"false\""))
    assertFalse(mainPolicy.contains("10.0.2.2"))
    assertTrue(debugPolicy.contains("cleartextTrafficPermitted=\"false\""))
    assertTrue(debugPolicy.contains(">10.0.2.2</domain>"))
  }
}
