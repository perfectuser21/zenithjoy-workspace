"""真实临时文件验证：同主题两次运行互不借产物。"""
import json
import sys
from pathlib import Path
from unittest.mock import patch
import pytest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from pipeline_worker.executors import research, export, copywriting, generate


def test_same_topic_two_research_runs_have_distinct_paths(tmp_path,monkeypatch):
    monkeypatch.setenv('CONTENT_OUTPUT_DIR',str(tmp_path))
    monkeypatch.delenv('E2E_FAKE_EXECUTORS',raising=False)
    with patch.object(research,'_run',return_value=json.dumps({'answer':'A real owned finding'})):
        one=research.execute_research({'pipeline_id':'run-one','keyword':'same-topic','notebook_id':'fixture'})
        two=research.execute_research({'pipeline_id':'run-two','keyword':'same-topic','notebook_id':'fixture'})
    assert one['success'] and two['success']
    assert one['findings_path'] != two['findings_path']
    assert Path(one['findings_path']).parent==tmp_path/'runs/run-one'
    assert Path(two['findings_path']).parent==tmp_path/'runs/run-two'


def test_export_never_reads_another_run_or_keyword_fallback(tmp_path,monkeypatch):
    monkeypatch.setenv('CONTENT_OUTPUT_DIR',str(tmp_path))
    monkeypatch.delenv('E2E_FAKE_EXECUTORS',raising=False)
    old=tmp_path/'2026-same-topic';(old/'cards').mkdir(parents=True)
    (old/'cards/old.png').write_bytes(b'foreign')
    with patch.object(export,'upload_to_nas') as upload:
        result=export.execute_export({'pipeline_id':'new-run','keyword':'same-topic'})
    assert result['success'] is False
    upload.assert_not_called()
    assert not (old/'manifest.json').exists()


def test_own_export_does_not_take_global_keyword_images(tmp_path,monkeypatch):
    monkeypatch.setenv('CONTENT_OUTPUT_DIR',str(tmp_path));monkeypatch.delenv('E2E_FAKE_EXECUTORS',raising=False)
    owned=tmp_path/'runs/new-run';(owned/'cards').mkdir(parents=True);(owned/'article').mkdir()
    (owned/'cards/copy.md').write_text('owned');(owned/'article/article.md').write_text('owned')
    foreign=tmp_path/'global-images';foreign.mkdir();(foreign/'same-topic-old.png').write_bytes(b'old')
    monkeypatch.setattr(export,'IMAGES_DIR',foreign,raising=False)
    with patch.object(export,'upload_to_nas',return_value={'success':True,'nas_path':'fixture'}) as upload:
        result=export.execute_export({'pipeline_id':'new-run','keyword':'same-topic','output_dir':str(owned)})
    assert result['success']
    assert result['card_count']==0
    assert upload.call_args.args[0]==str(owned)


def test_foreign_output_directory_and_symlink_findings_rejected(tmp_path,monkeypatch):
    monkeypatch.setenv('CONTENT_OUTPUT_DIR',str(tmp_path));monkeypatch.delenv('E2E_FAKE_EXECUTORS',raising=False)
    foreign=tmp_path/'runs/old';foreign.mkdir(parents=True);(foreign/'findings.json').write_text('{"findings": []}')
    with patch.object(copywriting,'_call_llm') as call:
        result=copywriting.execute_copywriting({'pipeline_id':'new','keyword':'same','output_dir':str(foreign)})
    assert not result['success'];call.assert_not_called()
    owned=tmp_path/'runs/new';owned.mkdir();(owned/'findings.json').symlink_to(foreign/'findings.json')
    with patch.object(copywriting,'_call_llm') as call:
        result=copywriting.execute_copywriting({'pipeline_id':'new','keyword':'same','output_dir':str(owned)})
    assert not result['success'];call.assert_not_called()


def test_research_lease_loss_after_first_external_write_blocks_second(tmp_path,monkeypatch):
    from pipeline_worker.brain_tasks import CoordinationUnknown
    monkeypatch.setenv('CONTENT_OUTPUT_DIR',str(tmp_path))
    monkeypatch.delenv('E2E_FAKE_EXECUTORS',raising=False)
    writes=[]
    def check():
        if writes:
            raise CoordinationUnknown('heartbeat unavailable')
    def external(command,timeout=60):
        writes.append(command)
        return 'not used'
    with patch.object(research,'_run',side_effect=external):
        with pytest.raises(CoordinationUnknown):
            research.execute_research({'pipeline_id':'guarded','keyword':'topic','notebook_id':'fixture','execution_guard':check})
    assert len(writes)==1
    assert writes[0].startswith('notebooklm use ')


def test_nas_lease_loss_after_mkdir_blocks_upload_and_retries(tmp_path):
    from pipeline_worker import nas_uploader
    from pipeline_worker.brain_tasks import CoordinationUnknown
    calls=[]
    def check():
        if calls:raise CoordinationUnknown('lease lost')
    def mkdir(*_):
        calls.append('mkdir');return True,''
    with patch.object(nas_uploader,'_run_mkdir',side_effect=mkdir),patch.object(nas_uploader,'_run_tar_over_ssh') as upload:
        with pytest.raises(CoordinationUnknown):
            nas_uploader.upload_to_nas(str(tmp_path),'safe-run',execution_guard=check)
    upload.assert_not_called()
