"""Windows unit tests must never enumerate the operator's real desktop."""

from __future__ import annotations

import sys

import pytest


@pytest.mark.skipif(sys.platform != "win32", reason="Windows desktop isolation guard")
def test_unit_suite_desktop_is_sandboxed():
    from pywinauto import Desktop

    assert Desktop(backend="uia").windows() == []
