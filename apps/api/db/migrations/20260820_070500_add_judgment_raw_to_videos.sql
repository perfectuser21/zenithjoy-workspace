-- acquisition_collect_videos 加 judgment_raw：判定 AI 的原始返回（截断存）
--
-- 为什么必须存：0817-0819 真机数据里 38 个视频有 36 个 extractTranscript 提不出「转写：」，
-- judgment_reason 里只剩解析后的碎片（parse_fallback / 视频 / via_commander|...），
-- 我们完全不知道模型到底吐了什么格式 —— 于是「解析对不上」这个 bug 无从修起。
-- 这跟 okhttp 刷屏把 agent 日志冲掉是同一类问题：不留证据 = 查不出根因。

ALTER TABLE zenithjoy.acquisition_collect_videos
  ADD COLUMN IF NOT EXISTS judgment_raw TEXT;
