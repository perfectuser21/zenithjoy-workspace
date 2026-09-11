#!/usr/bin/env python3
"""回归测试：公众号发布必须真正群发，不能只调 freepublish。

2026-09-11 真机验证：单独调用 freepublish/submit 能成功拿到 publish_id、文章也能在
freepublish/batchget 列表里查到，但不会出现在账号主页的"全部消息"历史里——用户在
自己手机上点进公众号主页看不到这篇文章。真正能让内容进主页历史 + 推送粉丝的动作是
message/mass/sendall（群发），这是与 freepublish 完全独立的接口。

本测试 mock 掉 WeChat 的 HTTP 层，跑一遍 publish() 的完整流程，断言调用序列里必须出现
message/mass/sendall，不能出现 freepublish/submit（旧脚本先 freepublish 再群发会导致
同一草稿的 media_id 被消费掉，第二次调用群发报 40007 invalid media_id，两者不能接力）。
"""
import importlib.util
import os
import sys
import unittest
from unittest import mock

SCRIPT_PATH = os.path.join(os.path.dirname(__file__), '..', 'wechat-mp-freepublish.py')


def _load_module():
    spec = importlib.util.spec_from_file_location('wechat_mp_freepublish', SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestWechatMpPublish(unittest.TestCase):
    def setUp(self):
        self.wmf = _load_module()
        self.calls = []

    def _fake_get(self, url):
        self.calls.append(('GET', url))
        return {'access_token': 'tok123'}

    def _fake_post_file(self, url, path, field='media'):
        self.calls.append(('POST_FILE', url))
        return {'media_id': 'thumb-media-1', 'url': 'http://mmbiz.qpic.cn/fake-thumb.jpg'}

    def _fake_post_json(self, url, payload):
        self.calls.append(('POST_JSON', url, payload))
        if 'draft/add' in url:
            return {'media_id': 'draft-media-1'}
        if 'freepublish/submit' in url:
            return {'errcode': 0, 'publish_id': 999}
        if 'freepublish/get' in url:
            return {'publish_status': 0, 'article_detail': {'item': [{'article_url': 'http://mp.weixin.qq.com/s?fake'}]}}
        if 'message/mass/sendall' in url:
            return {'errcode': 0, 'msg_id': 1000000048, 'msg_data_id': 2247484411}
        if 'message/mass/get' in url:
            return {'msg_id': 1000000048, 'msg_status': 'SEND_SUCCESS'}
        raise AssertionError(f'未预期的 API 调用: {url}')

    def _run_publish_with_mocks(self):
        with mock.patch.object(self.wmf, '_get', side_effect=self._fake_get), \
             mock.patch.object(self.wmf, '_post_file', side_effect=self._fake_post_file), \
             mock.patch.object(self.wmf, '_post_json', side_effect=self._fake_post_json):
            self.wmf.publish('/fake/cover.png', '测试标题', '测试正文', appid='fake-appid', secret='fake-secret')

    def test_publish_must_call_mass_sendall_to_be_visible_on_homepage(self):
        self._run_publish_with_mocks()
        called_urls = [c[1] for c in self.calls]
        mass_send_called = any('message/mass/sendall' in u for u in called_urls)
        self.assertTrue(
            mass_send_called,
            '发布流程没有调用 message/mass/sendall——真机验证过 freepublish/submit 单独调用'
            '不会让文章出现在公众号主页的"全部消息"历史里，必须真正群发才行。'
        )

    def test_publish_must_not_reuse_freepublished_draft_for_mass_send(self):
        """freepublish/submit 会消费掉草稿的 media_id，之后再群发同一个 media_id 会报
        40007 invalid media_id（2026-09-11 真机实测复现）。发布流程不应该先调用
        freepublish/submit 再指望同一份草稿还能拿去群发。"""
        self._run_publish_with_mocks()
        called_urls = [c[1] for c in self.calls]
        freepublish_called = any('freepublish/submit' in u for u in called_urls)
        self.assertFalse(
            freepublish_called,
            'freepublish/submit 不应该出现在发布流程里：它会锁死草稿的 media_id，'
            '导致后续 message/mass/sendall 对同一草稿报 40007 invalid media_id。'
        )


if __name__ == '__main__':
    unittest.main()
