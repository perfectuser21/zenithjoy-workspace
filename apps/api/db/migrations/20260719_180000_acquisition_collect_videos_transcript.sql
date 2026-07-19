-- apps/api/db/migrations/20260719_180000_acquisition_collect_videos_transcript.sql
-- Path2 评论区留言AI意向分档判定（decision 4e421ae8）：Seg2 音频判定时 Gemini 内部转写出的
-- 文案此前从不落库，只用于当次判定、判完即弃。本列把转写文案存下来，供 Seg3→Seg4 之间新增的
-- "评论意向分档"判定使用完整"标题+转写文案"，而不只是标题。

ALTER TABLE zenithjoy.acquisition_collect_videos
  ADD COLUMN IF NOT EXISTS transcript text;

COMMENT ON COLUMN zenithjoy.acquisition_collect_videos.transcript IS
  'Seg2音频判定时Gemini转写出的文案（仅capture_type=audio时产出），供评论意向分档判定使用完整视频文案';
