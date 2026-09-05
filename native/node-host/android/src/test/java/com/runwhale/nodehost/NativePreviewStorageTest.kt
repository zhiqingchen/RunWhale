package com.runwhale.nodehost

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class NativePreviewStorageTest {
  @Test
  fun `new AsyncStorage values are preserved without requiring JSON`() {
    assertEquals("plain text", mergeNativePreviewStorageValues(null, "plain text"))
  }

  @Test
  fun `AsyncStorage merge recursively combines JSON objects`() {
    val merged = JSONObject(
      mergeNativePreviewStorageValues(
        """{"profile":{"name":"Ada","theme":"dark"},"count":1}""",
        """{"profile":{"theme":"light","locale":"en"},"active":true}""",
      ),
    )

    assertEquals("Ada", merged.getJSONObject("profile").getString("name"))
    assertEquals("light", merged.getJSONObject("profile").getString("theme"))
    assertEquals("en", merged.getJSONObject("profile").getString("locale"))
    assertEquals(1, merged.getInt("count"))
    assertEquals(true, merged.getBoolean("active"))
  }
}
