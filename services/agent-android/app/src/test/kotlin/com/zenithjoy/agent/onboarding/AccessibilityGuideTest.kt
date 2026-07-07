package com.zenithjoy.agent.onboarding
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
class AccessibilityGuideTest {
  private val pkg = "com.zenithjoy.agent"
  private val cls = "com.zenithjoy.agent.collect.DouyinCollectService"
  @Test fun hit_single() { assertTrue(isServiceEnabled("$pkg/$cls", pkg, cls)) }
  @Test fun hit_among_many() {
    assertTrue(isServiceEnabled("com.other/x.Y:$pkg/$cls:com.z/A.B", pkg, cls))
  }
  @Test fun miss() { assertFalse(isServiceEnabled("com.other/x.Y", pkg, cls)) }
  @Test fun empty() { assertFalse(isServiceEnabled("", pkg, cls)) }
  @Test fun null_setting() { assertFalse(isServiceEnabled(null, pkg, cls)) }
}
