-- Skill Registry 种子数据 — 西安 PC 上已知的发布脚本
-- 来源：2026-04-28 SSH audit of C:\Users\xuxia\zenithjoy-agent\publishers\
-- 幂等：ON CONFLICT DO NOTHING，可重复执行

INSERT INTO zenithjoy.skills
  (slug, platform, category, name, content_type, is_dryrun, script_path, description)
VALUES

-- ── 抖音（douyin）──────────────────────────────────────────
('douyin_image_dryrun',
 'douyin', 'publish', '抖音图文发布（演练）',
 'image', true,
 'publishers/douyin-publisher/publish-douyin-image-dryrun.cjs',
 '抖音图文内容发布 dry-run，走完全流程但不真实提交'),

-- ── 快手（kuaishou）─────────────────────────────────────────
('kuaishou_image_dryrun',
 'kuaishou', 'publish', '快手图文发布（演练）',
 'image', true,
 'publishers/kuaishou-publisher/publish-kuaishou-image-dryrun.cjs',
 '快手图文内容发布 dry-run'),

('kuaishou_image_publish',
 'kuaishou', 'publish', '快手图文发布',
 'image', false,
 'publishers/kuaishou-publisher/publish-kuaishou-image.cjs',
 '快手图文内容真实发布（Playwright 自动化）'),

('kuaishou_video_publish',
 'kuaishou', 'publish', '快手视频发布',
 'video', false,
 'publishers/kuaishou-publisher/publish-kuaishou-video.cjs',
 '快手视频内容真实发布'),

('kuaishou_session_check',
 'kuaishou', 'account_mgmt', '快手登录状态检查',
 null, false,
 'publishers/kuaishou-publisher/check-kuaishou-session.cjs',
 '检查快手账号 Cookie/Session 是否有效'),

-- ── 视频号（shipinhao）──────────────────────────────────────
('shipinhao_image_dryrun',
 'shipinhao', 'publish', '视频号图文发布（演练）',
 'image', true,
 'publishers/shipinhao-publisher/publish-shipinhao-image-dryrun.cjs',
 '视频号图文内容发布 dry-run'),

('shipinhao_image_publish',
 'shipinhao', 'publish', '视频号图文发布',
 'image', false,
 'publishers/shipinhao-publisher/publish-shipinhao-image.cjs',
 '视频号图文内容真实发布'),

('shipinhao_video_publish',
 'shipinhao', 'publish', '视频号视频发布',
 'video', false,
 'publishers/shipinhao-publisher/publish-shipinhao-video.cjs',
 '视频号视频内容真实发布'),

('shipinhao_async_publish',
 'shipinhao', 'publish', '视频号异步发布',
 'video', false,
 'publishers/shipinhao-publisher/publish-shipinhao-async.js',
 '视频号异步上传（大视频文件）'),

('shipinhao_playwright_publish',
 'shipinhao', 'publish', '视频号 Playwright 发布',
 'video', false,
 'publishers/shipinhao-publisher/publish-shipinhao-playwright.js',
 '视频号通过 Playwright 浏览器自动化发布'),

('shipinhao_refresh_qr',
 'shipinhao', 'account_mgmt', '视频号二维码刷新',
 null, false,
 'publishers/shipinhao-publisher/shipinhao-refresh-qr.js',
 '刷新视频号登录二维码'),

('shipinhao_keepalive',
 'shipinhao', 'account_mgmt', '视频号 Session 保活',
 null, false,
 'publishers/shipinhao-publisher/keepalive.cjs',
 '定期访问维持视频号登录态'),

-- ── 头条（toutiao）──────────────────────────────────────────
('toutiao_article_publish',
 'toutiao', 'publish', '头条文章发布',
 'article', false,
 'publishers/toutiao-publisher/publish-toutiao-article.cjs',
 '今日头条图文文章真实发布'),

('toutiao_image_dryrun',
 'toutiao', 'publish', '头条图文发布（演练）',
 'image', true,
 'publishers/toutiao-publisher/publish-toutiao-image-dryrun.cjs',
 '头条图文内容发布 dry-run'),

('toutiao_image_publish',
 'toutiao', 'publish', '头条图文发布',
 'image', false,
 'publishers/toutiao-publisher/publish-toutiao-image.cjs',
 '头条图文内容真实发布'),

('toutiao_post_publish',
 'toutiao', 'publish', '头条微头条发布',
 'image', false,
 'publishers/toutiao-publisher/publish-toutiao-post.cjs',
 '头条微头条（短内容）发布'),

('toutiao_video_publish',
 'toutiao', 'publish', '头条视频发布',
 'video', false,
 'publishers/toutiao-publisher/publish-toutiao-video.cjs',
 '头条视频内容真实发布'),

-- ── 微博（weibo）────────────────────────────────────────────
('weibo_article_publish',
 'weibo', 'publish', '微博文章发布',
 'article', false,
 'publishers/weibo-publisher/publish-weibo-article.cjs',
 '微博长文文章真实发布'),

('weibo_image_dryrun',
 'weibo', 'publish', '微博图文发布（演练）',
 'image', true,
 'publishers/weibo-publisher/publish-weibo-image-dryrun.cjs',
 '微博图文内容发布 dry-run'),

('weibo_image_publish',
 'weibo', 'publish', '微博图文发布',
 'image', false,
 'publishers/weibo-publisher/publish-weibo-image.cjs',
 '微博图文内容真实发布'),

('weibo_video_publish',
 'weibo', 'publish', '微博视频发布',
 'video', false,
 'publishers/weibo-publisher/publish-weibo-video.cjs',
 '微博视频内容真实发布'),

-- ── 小红书（xiaohongshu）────────────────────────────────────
('xiaohongshu_article_publish',
 'xiaohongshu', 'publish', '小红书文章发布',
 'article', false,
 'publishers/xiaohongshu-publisher/publish-xiaohongshu-article.cjs',
 '小红书图文笔记真实发布'),

('xiaohongshu_image_dryrun',
 'xiaohongshu', 'publish', '小红书图文发布（演练）',
 'image', true,
 'publishers/xiaohongshu-publisher/publish-xiaohongshu-image-dryrun.cjs',
 '小红书图文内容发布 dry-run'),

('xiaohongshu_image_publish',
 'xiaohongshu', 'publish', '小红书图文发布',
 'image', false,
 'publishers/xiaohongshu-publisher/publish-xiaohongshu-image.cjs',
 '小红书图文笔记真实发布'),

('xiaohongshu_video_publish',
 'xiaohongshu', 'publish', '小红书视频发布',
 'video', false,
 'publishers/xiaohongshu-publisher/publish-xiaohongshu-video.cjs',
 '小红书视频笔记真实发布'),

-- ── 知乎（zhihu）────────────────────────────────────────────
('zhihu_article_publish',
 'zhihu', 'publish', '知乎文章发布',
 'article', false,
 'publishers/zhihu-publisher/publish-zhihu-article.cjs',
 '知乎专栏文章真实发布'),

('zhihu_idea_publish',
 'zhihu', 'publish', '知乎想法发布',
 'idea', false,
 'publishers/zhihu-publisher/publish-zhihu-idea.cjs',
 '知乎想法（短内容）真实发布'),

('zhihu_image_dryrun',
 'zhihu', 'publish', '知乎图文发布（演练）',
 'image', true,
 'publishers/zhihu-publisher/publish-zhihu-image-dryrun.cjs',
 '知乎图文内容发布 dry-run'),

('zhihu_video_publish',
 'zhihu', 'publish', '知乎视频发布',
 'video', false,
 'publishers/zhihu-publisher/publish-zhihu-video.cjs',
 '知乎视频内容真实发布')

ON CONFLICT (slug) DO NOTHING;
