"""Windows unit tests must never enumerate the operator's real desktop."""

from __future__ import annotations

import os
import sys


def test_unit_suite_desktop_is_sandboxed():
    assert os.environ.get("ZJ_TEST_DESKTOP_ISOLATED") == "1"

    if sys.platform == "win32":
        from pywinauto import Desktop

        assert Desktop(backend="uia").windows() == []
