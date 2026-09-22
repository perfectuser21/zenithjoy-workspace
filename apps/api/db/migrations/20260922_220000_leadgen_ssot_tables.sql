-- apps/api/db/migrations/20260922_220000_leadgen_ssot_tables.sql
-- ADB获客链路(services/phone-adb-controller)建数据库正本——0922主理人拍板系列决策第一刀。
--
-- 背景:系统②(ADB/crontab/飞书表格)是唯一真正在给金诺盛源/悦升云端两个租户产出线索、
-- 发私信的实现,但至今没有独立数据库,飞书多维表格本身就是唯一的数据存储。系统①
-- (apps/api的acquisition_*系列表+services/agent-android的Kotlin App)有完整数据库设计但
-- 验证长期休眠(acquisition_config 0行,agents心跳一个月未更新),即将正式退役。
--
-- 本迁移不复用acquisition_*系列表(那是系统①的,即将退役,字段设计也跟系统②飞书表字段
-- 对不上),新建一套贴合系统②飞书表字段习惯(中文列名)的独立表,作为新的"正本"(SSOT)——
-- 后续脚本(push-videos.js/push-raw-comments.js/sort-comments.js/next-outreach.js)改为
-- 先写这几张表,再单向同步一份到飞书给人看,飞书从"主存储"降级为"投影"。
--
-- 三张表对应关系:
--   leadgen_videos    ← 飞书"视频池"(push-videos.js写的),新增判定状态/判定理由/转写文案
--                       三个字段,为视频文案判定(阶段3,qwen-audio转写+Jev主判)铺路
--   leadgen_comments  ← 飞书"原始评论池"(push-raw-comments.js写的),新增业务相关性/意向等级/
--                       AI判定理由三个字段,为评论判定(Jev主判+大模型兜底)铺路
--   leadgen_leads     ← 飞书线索表(sort-comments.js write模式写的),含重复命中次数/重复轨迹
--                       (0914主理人拍板:重复≠噪音,是强意向信号,要高亮不要扔)

CREATE SCHEMA IF NOT EXISTS zenithjoy;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 1. 视频池表 ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS zenithjoy.leadgen_videos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_key          text NOT NULL,                       -- line-routes.js 的业务线key(jinuo/yuesheng)
  video_id          text NOT NULL,                        -- 抖音视频ID
  video_url         text,
  title             text NOT NULL DEFAULT '',              -- 视频标题/文案
  keyword           text,                                  -- 命中关键词
  comment_count     integer NOT NULL DEFAULT 0,
  discovered_at     timestamptz NOT NULL DEFAULT now(),
  harvest_batch     text,
  process_status    text NOT NULL DEFAULT '评论已采',       -- 沿用飞书视频池现有值域
  judgment_status   text NOT NULL DEFAULT 'pending',        -- pending | matched | rejected
  judgment_reason   text,
  transcript        text,                                   -- qwen-audio-3.0-asr-flash转写文案
  feishu_record_id  text,                                   -- 同步到飞书后的record_id,供后续更新定位
  feishu_synced_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_leadgen_videos_judgment CHECK (judgment_status IN ('pending', 'matched', 'rejected')),
  CONSTRAINT uq_leadgen_videos_line_video UNIQUE (line_key, video_id)
);

CREATE INDEX IF NOT EXISTS idx_leadgen_videos_judgment ON zenithjoy.leadgen_videos(line_key, judgment_status);

COMMENT ON TABLE zenithjoy.leadgen_videos IS
  'ADB获客链路(系统②)视频池正本——对应飞书"视频池"表,新增judgment_status/judgment_reason/transcript供视频文案判定(阶段3)使用';
COMMENT ON COLUMN zenithjoy.leadgen_videos.judgment_status IS
  'pending=待判定(V1扫这个状态) | matched=Jev或大模型复核判定匹配目标人群,放行采评论 | rejected=判定不匹配,不采评论';

-- ── 2. 原始评论池表 ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS zenithjoy.leadgen_comments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_key            text NOT NULL,
  dedup_key           text NOT NULL,                        -- 昵称+抖音号+评论前20字组合key(见push-raw-comments.js现有rid逻辑)
  harvest_batch       text,
  collected_at        timestamptz NOT NULL DEFAULT now(),
  keyword             text,
  source_video        text,
  source_video_url    text,
  comment_body        text NOT NULL DEFAULT '',
  nickname            text NOT NULL DEFAULT '',
  douyin_id           text,
  profile_url         text,
  account_type        text,
  comment_time        text,                                  -- 沿用飞书现有的文本型留言时间字段
  profile_ip          text,
  region              text,
  process_status      text NOT NULL DEFAULT '待分拣',          -- 待分拣 | 已分拣
  relevance           text,                                    -- 相关 | 不相关
  intent_grade        text,                                    -- A | B | C
  judgment_reason     text,
  feishu_record_id    text,
  feishu_synced_at    timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_leadgen_comments_status CHECK (process_status IN ('待分拣', '已分拣')),
  CONSTRAINT chk_leadgen_comments_relevance CHECK (relevance IS NULL OR relevance IN ('相关', '不相关')),
  CONSTRAINT chk_leadgen_comments_grade CHECK (intent_grade IS NULL OR intent_grade IN ('A', 'B', 'C')),
  CONSTRAINT uq_leadgen_comments_line_dedup UNIQUE (line_key, dedup_key)
);

CREATE INDEX IF NOT EXISTS idx_leadgen_comments_pending ON zenithjoy.leadgen_comments(line_key, process_status);

COMMENT ON TABLE zenithjoy.leadgen_comments IS
  'ADB获客链路(系统②)原始评论池正本——对应飞书"原始评论池"表,dedup_key=昵称|抖音号|评论前20字,唯一约束替代原先脚本内存里的Set去重';

-- ── 3. 线索表 ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS zenithjoy.leadgen_leads (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_key            text NOT NULL,
  nickname            text NOT NULL,
  douyin_id           text,
  profile_url         text,
  comment_body        text,
  source_video        text,
  status              text NOT NULL DEFAULT '待触达',          -- 待触达 | 触达中 | 已触达 | 触达受阻 | 待补链
  send_status         text NOT NULL DEFAULT '未发送',
  ai_judgment_reason  text,
  dup_hit_count       integer NOT NULL DEFAULT 0,             -- 重复命中次数(0914拍板:重复=强意向信号)
  dup_trace           text,                                    -- 重复轨迹追加记录
  script_version      text,
  reached_at          timestamptz,
  feishu_record_id    text,
  feishu_synced_at    timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_leadgen_leads_line_nickname UNIQUE (line_key, nickname)
);

CREATE INDEX IF NOT EXISTS idx_leadgen_leads_pending ON zenithjoy.leadgen_leads(line_key, status);
CREATE INDEX IF NOT EXISTS idx_leadgen_leads_douyin_id ON zenithjoy.leadgen_leads(line_key, douyin_id);

COMMENT ON TABLE zenithjoy.leadgen_leads IS
  'ADB获客链路(系统②)线索表正本——对应飞书线索表,(line_key,nickname)唯一约束替代原先next-outreach.js/sort-comments.js内存里的Map去重判断';
