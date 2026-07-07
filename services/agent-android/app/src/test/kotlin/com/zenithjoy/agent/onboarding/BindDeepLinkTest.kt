package com.zenithjoy.agent.onboarding
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
class BindDeepLinkTest {
  @Test fun parses_license_and_api() {
    val p = parseBindDeepLink("zenithjoy://bind?license=ZJ-F-A1B2C3D4&api=wss%3A%2F%2Fx%2Fagent-ws")
    assertEquals("ZJ-F-A1B2C3D4", p.license)
    assertEquals("wss://x/agent-ws", p.api)
  }
  @Test fun wrong_scheme_returns_empty() {
    val p = parseBindDeepLink("http://bind?license=X")
    assertNull(p.license); assertNull(p.api)
  }
  @Test fun no_query_returns_empty() {
    val p = parseBindDeepLink("zenithjoy://bind")
    assertNull(p.license); assertNull(p.api)
  }
  @Test fun null_returns_empty() {
    val p = parseBindDeepLink(null)
    assertNull(p.license); assertNull(p.api)
  }
  @Test fun license_only() {
    val p = parseBindDeepLink("zenithjoy://bind?license=ZJ-F-XXXX0000")
    assertEquals("ZJ-F-XXXX0000", p.license); assertNull(p.api)
  }
}
