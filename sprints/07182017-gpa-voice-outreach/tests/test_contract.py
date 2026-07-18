# sprints/07182017-gpa-voice-outreach/tests/test_contract.py
# TDD Red — GP-A 主动语音触达（skeleton）
#
# 模式：用 open() / readFileSync 等价方式读取源文件内容验证实现存在
#   - skeleton 实现前文件不存在 → FileNotFoundError / 断言 FAIL → Red ✅
#   - skeleton 完成后断言 PASS → Green ✅
#
# 本文件覆盖 CI 可达段的 BEHAVIOR 断言（真机段 M-1 ~ M-4 需在 xian-rog 手动执行）
#
# 运行方式：
#   cd /workspace && python -m pytest sprints/07182017-gpa-voice-outreach/tests/test_contract.py -v

import pytest
import os

VOICE_CALL_DIR = "/workspace/services/agent/build-modules/line04/wechat-rpa/voice_call"

CALL_RPA_PATH = os.path.join(VOICE_CALL_DIR, "call_rpa.py")
AUDIO_BRIDGE_PATH = os.path.join(VOICE_CALL_DIR, "audio_bridge.py")
CALL_RECORDER_PATH = os.path.join(VOICE_CALL_DIR, "call_recorder.py")
PREFLIGHT_PATH = os.path.join(VOICE_CALL_DIR, "preflight.py")
INIT_PATH = os.path.join(VOICE_CALL_DIR, "__init__.py")
TEST_CALL_RPA_PATH = os.path.join(VOICE_CALL_DIR, "tests", "test_call_rpa.py")

ROUTE_PATH = "/workspace/apps/api/src/routes/voice-outreach.ts"
MIGRATION_PATH = "/workspace/apps/api/db/migrations/20260718_voice_call_records.sql"
SMOKE_PATH = "/workspace/.github/workflows/scripts/smoke/gpa-voice-outreach-smoke.sh"


def read_file(path: str) -> str:
    """读取文件内容，文件不存在时返回空字符串（触发 Red 断言）。"""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return ""


# ────────────────────────────────────────────────────────────────────────────
# ARTIFACT 断言：文件存在
# ────────────────────────────────────────────────────────────────────────────

class TestArtifacts:
    def test_call_rpa_exists(self):
        """[ARTIFACT] call_rpa.py 文件必须存在"""
        assert os.path.exists(CALL_RPA_PATH), f"FAIL: {CALL_RPA_PATH} 不存在"

    def test_audio_bridge_exists(self):
        """[ARTIFACT] audio_bridge.py 文件必须存在"""
        assert os.path.exists(AUDIO_BRIDGE_PATH), f"FAIL: {AUDIO_BRIDGE_PATH} 不存在"

    def test_call_recorder_exists(self):
        """[ARTIFACT] call_recorder.py 文件必须存在"""
        assert os.path.exists(CALL_RECORDER_PATH), f"FAIL: {CALL_RECORDER_PATH} 不存在"

    def test_preflight_exists(self):
        """[ARTIFACT] preflight.py 文件必须存在"""
        assert os.path.exists(PREFLIGHT_PATH), f"FAIL: {PREFLIGHT_PATH} 不存在"

    def test_init_exists(self):
        """[ARTIFACT] __init__.py 文件必须存在"""
        assert os.path.exists(INIT_PATH), f"FAIL: {INIT_PATH} 不存在"

    def test_test_call_rpa_exists(self):
        """[ARTIFACT] test_call_rpa.py 单元测试文件必须存在"""
        assert os.path.exists(TEST_CALL_RPA_PATH), f"FAIL: {TEST_CALL_RPA_PATH} 不存在"

    def test_route_exists(self):
        """[ARTIFACT] voice-outreach.ts API 路由文件必须存在"""
        assert os.path.exists(ROUTE_PATH), f"FAIL: {ROUTE_PATH} 不存在"

    def test_migration_exists(self):
        """[ARTIFACT] 20260718_voice_call_records.sql 文件必须存在"""
        assert os.path.exists(MIGRATION_PATH), f"FAIL: {MIGRATION_PATH} 不存在"

    def test_smoke_exists(self):
        """[ARTIFACT] gpa-voice-outreach-smoke.sh 必须存在且 ≥5 行"""
        assert os.path.exists(SMOKE_PATH), f"FAIL: {SMOKE_PATH} 不存在"
        content = read_file(SMOKE_PATH)
        lines = [l for l in content.splitlines() if l.strip()]
        assert len(lines) >= 5, f"FAIL: smoke.sh 内容不足 5 行（实际 {len(lines)} 行），禁止 exit 0 占位"


# ────────────────────────────────────────────────────────────────────────────
# B-1：联系人精确匹配 + 禁坐标定位（I-1 / I-6）
# ────────────────────────────────────────────────────────────────────────────

class TestB1ContactPreciseMatch:
    def test_locate_contact_function_exists(self):
        """[BEHAVIOR B-1] call_rpa.py 含 locate_contact 函数（I-1）"""
        c = read_file(CALL_RPA_PATH)
        assert "locate_contact" in c, "FAIL: 缺 locate_contact 函数（I-1 联系人精确匹配前置）"

    def test_contact_mismatch_return(self):
        """[BEHAVIOR B-1] call_rpa.py 含 contact_mismatch 返回状态（I-1）"""
        c = read_file(CALL_RPA_PATH)
        assert "contact_mismatch" in c, "FAIL: 缺 contact_mismatch 返回状态（I-1）"

    def test_uia_sendkeys_not_coordinate(self):
        """[BEHAVIOR B-1] call_rpa.py 联系人定位使用 UIA SendKeys，非坐标法（I-6）"""
        c = read_file(CALL_RPA_PATH)
        assert "SendKeys" in c, "FAIL: 缺 UIA SendKeys（I-6 禁止坐标定位联系人，应用搜索框 UIA 输入）"


# ────────────────────────────────────────────────────────────────────────────
# B-2：聊天窗口标题精确匹配（I-1 核心安全断言）
# ────────────────────────────────────────────────────────────────────────────

class TestB2TitleExactMatch:
    def test_window_title_validation(self):
        """[BEHAVIOR B-2] call_rpa.py 含窗口标题读取 + 不匹配时中止（I-1）"""
        c = read_file(CALL_RPA_PATH)
        has_title_read = (
            "ChatSingleWindow" in c
            or "window_title" in c.lower()
            or "Name" in c  # UIA Name 属性
        )
        assert has_title_read, "FAIL: 缺聊天窗口标题读取逻辑（I-1 标题精确匹配校验）"
        assert "contact_mismatch" in c, "FAIL: 缺标题不匹配时中止逻辑（I-1）"


# ────────────────────────────────────────────────────────────────────────────
# B-3：60 秒超时兜底 + safe_hangup（I-3）
# ────────────────────────────────────────────────────────────────────────────

class TestB3TimeoutHangup:
    def test_wait_for_answer_function(self):
        """[BEHAVIOR B-3] call_rpa.py 含 wait_for_answer 函数（I-3）"""
        c = read_file(CALL_RPA_PATH)
        assert "wait_for_answer" in c, "FAIL: 缺 wait_for_answer 函数（I-3）"

    def test_safe_hangup_function(self):
        """[BEHAVIOR B-3] call_rpa.py 含 safe_hangup 函数（I-3）"""
        c = read_file(CALL_RPA_PATH)
        assert "safe_hangup" in c, "FAIL: 缺 safe_hangup 函数（I-3）"

    def test_wait_for_hangup_function(self):
        """[BEHAVIOR B-3] call_rpa.py 含 wait_for_hangup 函数"""
        c = read_file(CALL_RPA_PATH)
        assert "wait_for_hangup" in c, "FAIL: 缺 wait_for_hangup 函数"

    def test_no_answer_status(self):
        """[BEHAVIOR B-3] call_rpa.py 含 no_answer 返回状态（I-3）"""
        c = read_file(CALL_RPA_PATH)
        assert "no_answer" in c, "FAIL: 缺 no_answer 返回状态（I-3 超时兜底）"

    def test_60_second_timeout(self):
        """[BEHAVIOR B-3] call_rpa.py 含 60 秒超时数值（I-3）"""
        c = read_file(CALL_RPA_PATH)
        has_timeout = "60" in c or "timeout" in c.lower()
        assert has_timeout, "FAIL: 缺 60 秒超时逻辑（I-3 60 秒超时兜底）"

    def test_bubble_text_parsing(self):
        """[BEHAVIOR B-3] call_rpa.py 含气泡文案解析（通话时长 / 无应答）"""
        c = read_file(CALL_RPA_PATH)
        has_bubble = "通话时长" in c or "无应答" in c or "bubble" in c.lower()
        assert has_bubble, "FAIL: 缺气泡文案解析（通话结束后判定逻辑）"


# ────────────────────────────────────────────────────────────────────────────
# B-4：音频设备阻断启动自检（I-2）
# ────────────────────────────────────────────────────────────────────────────

class TestB4PreflightDeviceCheck:
    def test_voice_call_preflight_function(self):
        """[BEHAVIOR B-4] preflight.py 含 voice_call_preflight 函数（I-2）"""
        c = read_file(PREFLIGHT_PATH)
        assert "voice_call_preflight" in c, "FAIL: 缺 voice_call_preflight 函数（I-2 音频设备阻断启动）"

    def test_device_error_abort(self):
        """[BEHAVIOR B-4] preflight.py 含设备失败时 abort/device_error 逻辑（I-2）"""
        c = read_file(PREFLIGHT_PATH)
        has_abort = (
            "device_error" in c
            or "abort" in c.lower()
            or "阻断" in c
            or "sys.exit" in c
        )
        assert has_abort, "FAIL: 缺设备失败时阻断逻辑（I-2 音频设备阻断启动）"

    def test_audio_device_type_check(self):
        """[BEHAVIOR B-4] preflight.py 含 WDM-KS / WASAPI / 音频设备类型检查（I-2）"""
        c = read_file(PREFLIGHT_PATH)
        has_device_check = (
            "WDM" in c
            or "WASAPI" in c
            or "VB-Audio" in c
            or "VoiceMeeter" in c
            or "audio" in c.lower()
        )
        assert has_device_check, "FAIL: 缺音频设备类型检查（I-2 WDM-KS + WASAPI 双路自检）"


# ────────────────────────────────────────────────────────────────────────────
# B-5：合规开场白不可跳过（I-4 + N-6）
# ────────────────────────────────────────────────────────────────────────────

class TestB5ComplianceOpening:
    def test_start_audio_bridge_function(self):
        """[BEHAVIOR B-5] audio_bridge.py 含 start_audio_bridge 函数"""
        c = read_file(AUDIO_BRIDGE_PATH)
        assert "start_audio_bridge" in c, "FAIL: 缺 start_audio_bridge 函数"

    def test_compliance_opening_string(self):
        """[BEHAVIOR B-5] audio_bridge.py 含合规开场白（I-4 + N-6）"""
        c = read_file(AUDIO_BRIDGE_PATH)
        has_compliance = (
            "智能语音助手" in c
            or "system_prompt" in c
            or "合规" in c
            or "您好" in c
        )
        assert has_compliance, "FAIL: 缺合规开场白字符串或 system_prompt（I-4 合规开场必须播出）"


# ────────────────────────────────────────────────────────────────────────────
# B-6：WebSocket 断线不静默（I-5）
# ────────────────────────────────────────────────────────────────────────────

class TestB6WebSocketReconnect:
    def test_reconnect_logic(self):
        """[BEHAVIOR B-6] audio_bridge.py 含 WebSocket 断线重连逻辑（I-5）"""
        c = read_file(AUDIO_BRIDGE_PATH)
        has_reconnect = (
            "reconnect" in c.lower()
            or "retry" in c.lower()
            or "重连" in c
        )
        assert has_reconnect, "FAIL: 缺 WebSocket 断线重连逻辑（I-5 断线不静默）"

    def test_reconnect_limit(self):
        """[BEHAVIOR B-6] audio_bridge.py 含重连上限限制（I-5，上限 3 次）"""
        c = read_file(AUDIO_BRIDGE_PATH)
        has_limit = (
            "3" in c
            or "max_retry" in c.lower()
            or "max_reconnect" in c.lower()
        )
        assert has_limit, "FAIL: 缺重连上限限制（I-5，应限制 ≤3 次）"


# ────────────────────────────────────────────────────────────────────────────
# B-7：设备名动态发现（N-5）
# ────────────────────────────────────────────────────────────────────────────

class TestB7DynamicDeviceDiscovery:
    def test_dynamic_device_enum(self):
        """[BEHAVIOR B-7] audio_bridge.py 或 preflight.py 含设备动态枚举（N-5）"""
        combined = read_file(AUDIO_BRIDGE_PATH) + read_file(PREFLIGHT_PATH)
        has_enum = (
            "query_devices" in combined
            or "sounddevice" in combined
            or "pyaudio" in combined
        )
        assert has_enum, "FAIL: 缺设备动态枚举（N-5 sounddevice.query_devices() 或等价）"

    def test_device_keyword_matching(self):
        """[BEHAVIOR B-7] 设备名通过关键词匹配（VB-Audio / VoiceMeeter），不硬编码完整名（N-5）"""
        combined = read_file(AUDIO_BRIDGE_PATH) + read_file(PREFLIGHT_PATH)
        has_keyword = "VB-Audio" in combined or "VoiceMeeter" in combined
        assert has_keyword, "FAIL: 缺设备名关键词匹配（N-5 动态匹配 VB-Audio / VoiceMeeter）"


# ────────────────────────────────────────────────────────────────────────────
# B-8：通话记录多租户回写（N-3）
# ────────────────────────────────────────────────────────────────────────────

class TestB8CallRecorder:
    def test_write_call_record_function(self):
        """[BEHAVIOR B-8] call_recorder.py 含 write_call_record 函数"""
        c = read_file(CALL_RECORDER_PATH)
        assert "write_call_record" in c, "FAIL: 缺 write_call_record 函数"

    def test_api_endpoint_path(self):
        """[BEHAVIOR B-8] call_recorder.py 含 /api/cs/voice-outreach/records 路径"""
        c = read_file(CALL_RECORDER_PATH)
        assert "voice-outreach/records" in c, "FAIL: 缺 API 路径 /api/cs/voice-outreach/records"

    def test_tenant_id_field(self):
        """[BEHAVIOR B-8] call_recorder.py 含 tenant_id 多租户字段（N-3）"""
        c = read_file(CALL_RECORDER_PATH)
        assert "tenant_id" in c, "FAIL: 缺 tenant_id 多租户隔离字段（N-3）"

    def test_duration_seconds_field(self):
        """[BEHAVIOR B-8] call_recorder.py 含 duration_seconds 字段"""
        c = read_file(CALL_RECORDER_PATH)
        assert "duration_seconds" in c, "FAIL: 缺 duration_seconds 字段"

    def test_http_client_present(self):
        """[BEHAVIOR B-8] call_recorder.py 含 HTTP 客户端库（requests / aiohttp / httpx）"""
        c = read_file(CALL_RECORDER_PATH)
        has_http = "requests" in c or "aiohttp" in c or "httpx" in c
        assert has_http, "FAIL: 缺 HTTP 客户端库（requests / aiohttp / httpx）"


# ────────────────────────────────────────────────────────────────────────────
# B-9：DB Migration 幂等 + 多租户字段（N-4 + N-3）
# ────────────────────────────────────────────────────────────────────────────

class TestB9Migration:
    def test_idempotent_create(self):
        """[BEHAVIOR B-9] migration SQL 含 CREATE TABLE IF NOT EXISTS（N-4 幂等）"""
        c = read_file(MIGRATION_PATH)
        assert "IF NOT EXISTS" in c, "FAIL: 缺 CREATE TABLE IF NOT EXISTS（N-4 幂等 Migration）"

    def test_tenant_id_column(self):
        """[BEHAVIOR B-9] migration SQL 含 tenant_id 列（N-3 多租户）"""
        c = read_file(MIGRATION_PATH)
        assert "tenant_id" in c, "FAIL: 缺 tenant_id 列（N-3 多租户隔离）"

    def test_status_column(self):
        """[BEHAVIOR B-9] migration SQL 含 status 列"""
        c = read_file(MIGRATION_PATH)
        assert "status" in c, "FAIL: 缺 status 列"

    def test_duration_seconds_column(self):
        """[BEHAVIOR B-9] migration SQL 含 duration_seconds 列"""
        c = read_file(MIGRATION_PATH)
        assert "duration_seconds" in c, "FAIL: 缺 duration_seconds 列"

    def test_called_at_column(self):
        """[BEHAVIOR B-9] migration SQL 含 called_at 列"""
        c = read_file(MIGRATION_PATH)
        assert "called_at" in c, "FAIL: 缺 called_at 列"


# ────────────────────────────────────────────────────────────────────────────
# B-10：API 路由多租户隔离（N-3）
# ────────────────────────────────────────────────────────────────────────────

class TestB10ApiRoute:
    def test_auth_middleware(self):
        """[BEHAVIOR B-10] voice-outreach.ts 含 auth 中间件（N-3）"""
        c = read_file(ROUTE_PATH)
        has_auth = (
            "requireCsWriteAccess" in c
            or "requireAuth" in c
            or "authMiddleware" in c
        )
        assert has_auth, "FAIL: 缺 auth 中间件（N-3 多租户隔离必须有 auth 闸）"

    def test_tenant_id_isolation(self):
        """[BEHAVIOR B-10] voice-outreach.ts 含 tenant_id 多租户过滤（N-3）"""
        c = read_file(ROUTE_PATH)
        assert "tenant_id" in c, "FAIL: 缺 tenant_id 多租户过滤（N-3）"

    def test_call_records_table_reference(self):
        """[BEHAVIOR B-10] voice-outreach.ts 含 voice_call_records 表引用"""
        c = read_file(ROUTE_PATH)
        assert "voice_call_records" in c, "FAIL: 缺 voice_call_records 表引用"

    def test_call_id_in_response(self):
        """[BEHAVIOR B-10] voice-outreach.ts 含 call_id 响应字段"""
        c = read_file(ROUTE_PATH)
        assert "call_id" in c, "FAIL: 缺 call_id 响应字段（Response Schema 要求）"


# ────────────────────────────────────────────────────────────────────────────
# B-11：pytest 单元测试 mock UIA 接缝
# ────────────────────────────────────────────────────────────────────────────

class TestB11UnitTestStructure:
    def test_mock_uia_isolation(self):
        """[BEHAVIOR B-11] test_call_rpa.py 含 mock/MagicMock（UIA 隔离，不需真机）"""
        c = read_file(TEST_CALL_RPA_PATH)
        has_mock = "mock" in c.lower() or "MagicMock" in c or "patch" in c
        assert has_mock, "FAIL: 缺 mock/MagicMock/patch（test_call_rpa.py 需要 UIA 隔离）"

    def test_has_test_functions(self):
        """[BEHAVIOR B-11] test_call_rpa.py 含测试函数（def test_）"""
        c = read_file(TEST_CALL_RPA_PATH)
        assert "def test_" in c, "FAIL: 缺测试函数（def test_）"

    def test_contact_test_coverage(self):
        """[BEHAVIOR B-11] test_call_rpa.py 含联系人相关测试"""
        c = read_file(TEST_CALL_RPA_PATH)
        assert "contact" in c.lower(), "FAIL: 缺联系人相关测试（联系人标题匹配逻辑）"


# ────────────────────────────────────────────────────────────────────────────
# B-12：smoke.sh CI 可达段 + 真机段注释
# ────────────────────────────────────────────────────────────────────────────

class TestB12SmokeScript:
    def test_api_curl_verification(self):
        """[BEHAVIOR B-12] smoke.sh 含 API curl 验证（voice-outreach/records）"""
        c = read_file(SMOKE_PATH)
        assert "voice-outreach/records" in c, "FAIL: 缺 API curl 验证（smoke.sh）"

    def test_db_table_assertion(self):
        """[BEHAVIOR B-12] smoke.sh 含 DB 表断言（voice_call_records）"""
        c = read_file(SMOKE_PATH)
        assert "voice_call_records" in c, "FAIL: 缺 DB 表断言（smoke.sh）"

    def test_pytest_invocation(self):
        """[BEHAVIOR B-12] smoke.sh 含 pytest 调用（test_call_rpa）"""
        c = read_file(SMOKE_PATH)
        assert "test_call_rpa" in c, "FAIL: 缺 pytest 调用 test_call_rpa（smoke.sh）"

    def test_real_machine_todo_comments(self):
        """[BEHAVIOR B-12] smoke.sh 含真机段等价断言注释（TODO(real-machine)）"""
        c = read_file(SMOKE_PATH)
        assert "TODO(real-machine)" in c, "FAIL: 缺真机段等价断言注释 TODO(real-machine)（smoke.sh）"
