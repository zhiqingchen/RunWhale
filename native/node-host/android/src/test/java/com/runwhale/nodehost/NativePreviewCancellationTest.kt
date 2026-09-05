package com.runwhale.nodehost

import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NativePreviewCancellationTest {
  @Test
  fun `request gate ignores stale completion after a newer launch begins`() {
    val gate = NativePreviewRequestGate()

    assertTrue(gate.begin("request-a"))
    assertTrue(gate.finish("request-a"))
    assertTrue(gate.begin("request-b"))
    assertFalse(gate.finish("request-a"))
    assertTrue(gate.isCurrent("request-b"))
  }

  @Test
  fun `coordinator cancellation settles and notifies only the requested launch`() {
    val firstId = UUID.randomUUID().toString()
    val secondId = UUID.randomUUID().toString()
    var firstResult: NativePreviewLaunchResult? = null
    var secondResult: NativePreviewLaunchResult? = null
    val cancelled = mutableListOf<String>()
    val subscription = NativePreviewLaunchCoordinator.addCancellationListener(cancelled::add)

    try {
      NativePreviewLaunchCoordinator.register(firstId) { firstResult = it }
      NativePreviewLaunchCoordinator.register(secondId) { secondResult = it }

      assertTrue(NativePreviewLaunchCoordinator.cancel(firstId))
      assertEquals("launch_cancelled", firstResult?.code)
      assertNull(secondResult)
      assertTrue(NativePreviewLaunchCoordinator.isPending(secondId))
      assertEquals(listOf(firstId), cancelled)

      assertFalse(NativePreviewLaunchCoordinator.cancel(firstId))
      assertEquals(listOf(firstId), cancelled)
      assertTrue(
        NativePreviewLaunchCoordinator.complete(
          secondId,
          NativePreviewLaunchResult(opened = true),
        ),
      )
      assertEquals(true, secondResult?.opened)
    } finally {
      subscription.remove()
      NativePreviewLaunchCoordinator.unregister(firstId)
      NativePreviewLaunchCoordinator.unregister(secondId)
    }
  }

  @Test
  fun `activity stays alive when cancelling an old request with a newer one pending`() {
    val pending = linkedSetOf("request-a", "request-b")

    assertFalse(
      shouldFinishNativePreviewAfterCancellation(
        pendingRequestIds = pending,
        requestId = "request-a",
      ),
    )
    assertEquals(setOf("request-b"), pending)
    assertFalse(
      shouldFinishNativePreviewAfterCancellation(
        pendingRequestIds = pending,
        requestId = "request-a",
      ),
    )
    assertTrue(
      shouldFinishNativePreviewAfterCancellation(
        pendingRequestIds = pending,
        requestId = "request-b",
      ),
    )
  }

  @Test
  fun `cancellation before registration is consumed by only that launch`() {
    val requestId = UUID.randomUUID().toString()
    var result: NativePreviewLaunchResult? = null

    try {
      assertTrue(NativePreviewLaunchCoordinator.cancel(requestId))
      assertFalse(NativePreviewLaunchCoordinator.register(requestId) { result = it })
      assertEquals("launch_cancelled", result?.code)
      assertFalse(NativePreviewLaunchCoordinator.isPending(requestId))
    } finally {
      NativePreviewLaunchCoordinator.unregister(requestId)
    }
  }
}
