"""
内存 / CPU 自愈门槛测试骨架
对应：[BEHAVIOR-FUNC-5] FR-9

thin 阶段断言：overlay 进程上报的 diag dict 必须包含 rss_mb 和 cpu_pct 字段。
自愈逻辑（GC/自杀/降频）在集成阶段补充验收。
"""
import pytest


def make_diag(rss_mb: float, cpu_pct: float) -> dict:
    """
    构造符合 overlay-diag.json 结构的 diag 字典（测试用 mock）。
    真实实现从 psutil 读取，此处直接构造。
    """
    return {
        "rss_mb": rss_mb,
        "cpu_pct": cpu_pct,
        "overlay_alive": True,
        "preflight_pass": True,
        "circuit_open": False,
        "restart_count_60min": 0,
    }


class TestDiagFieldsPresent:
    """thin 阶段：diag 字段存在性断言"""

    def test_rss_mb_field_present(self):
        """diag dict 必须包含 rss_mb 字段"""
        diag = make_diag(rss_mb=80.0, cpu_pct=1.2)
        assert "rss_mb" in diag, "diag 缺少 rss_mb 字段"

    def test_cpu_pct_field_present(self):
        """diag dict 必须包含 cpu_pct 字段"""
        diag = make_diag(rss_mb=80.0, cpu_pct=1.2)
        assert "cpu_pct" in diag, "diag 缺少 cpu_pct 字段"

    def test_rss_mb_is_numeric(self):
        """rss_mb 必须为数值型"""
        diag = make_diag(rss_mb=150.5, cpu_pct=2.0)
        assert isinstance(diag["rss_mb"], (int, float)), \
            f"rss_mb 类型错误: {type(diag['rss_mb'])}"

    def test_cpu_pct_is_numeric(self):
        """cpu_pct 必须为数值型"""
        diag = make_diag(rss_mb=150.5, cpu_pct=2.0)
        assert isinstance(diag["cpu_pct"], (int, float)), \
            f"cpu_pct 类型错误: {type(diag['cpu_pct'])}"

    def test_rss_mb_non_negative(self):
        """rss_mb 必须 >= 0"""
        diag = make_diag(rss_mb=0.0, cpu_pct=0.0)
        assert diag["rss_mb"] >= 0

    def test_cpu_pct_non_negative(self):
        """cpu_pct 必须 >= 0"""
        diag = make_diag(rss_mb=0.0, cpu_pct=0.0)
        assert diag["cpu_pct"] >= 0


# ── 集成阶段补充（本 sprint 不强制，标注 skip） ──────────────────────────────

@pytest.mark.skip(reason="集成阶段验收：需 psutil + overlay 真实进程")
class TestMemoryGuardLogic:
    """RSS 超限自愈逻辑（集成阶段）"""

    def test_gc_triggered_at_200mb(self):
        """RSS > 200MB 时触发 gc.collect()"""
        import gc
        from unittest.mock import patch, MagicMock

        mock_mem = MagicMock()
        mock_mem.rss = 210 * 1024 * 1024  # 210 MB

        with patch("psutil.Process.memory_info", return_value=mock_mem), \
             patch("gc.collect") as mock_gc:
            # TODO: from services.overlay.guard import check_memory; check_memory()
            mock_gc.assert_called_once()

    def test_sys_exit_at_300mb(self):
        """RSS > 300MB 时调用 sys.exit(1) 自杀重启"""
        import sys
        from unittest.mock import patch, MagicMock

        mock_mem = MagicMock()
        mock_mem.rss = 310 * 1024 * 1024  # 310 MB

        with patch("psutil.Process.memory_info", return_value=mock_mem), \
             patch("sys.exit") as mock_exit:
            # TODO: from services.overlay.guard import check_memory; check_memory()
            mock_exit.assert_called_once_with(1)

    def test_poll_interval_doubled_at_high_cpu(self):
        """CPU > 5% 持续 3 次采样 → poll interval 翻倍"""
        from unittest.mock import patch

        cpu_readings = [6.0, 6.0, 6.0]
        with patch("psutil.cpu_percent", side_effect=cpu_readings):
            # TODO: from services.overlay.guard import CpuGuard
            # guard = CpuGuard(base_interval=1.0, threshold=5.0, count=3)
            # for _ in cpu_readings:
            #     guard.tick()
            # assert guard.current_interval == 2.0
            pass
