package com.runwhale.nodehost

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NodeRuntimeStartGateTest {
  @Test
  fun processWideNodeEntryCanOnlyBeClaimedOnce() {
    val gate = NodeRuntimeStartGate()

    assertTrue(gate.claim())
    assertFalse(gate.claim())
  }
}
