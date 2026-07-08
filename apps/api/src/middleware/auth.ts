/**
 * auth — 公共鉴权中间件薄层，供路由 import 并允许测试 vi.mock 拦截。
 * requireCsWriteAccess 实现在 cs-config-guard；bodyWechatIdToParam 在此定义（共享）。
 */
import type { Request, Response, NextFunction } from 'express';
export { requireCsWriteAccess } from './cs-config-guard';

/**
 * 把 body.wechat_id 映射到 req.params.wechatId，
 * 供 requireCsWriteAccess('wechatId') 按 wechat_id → tenant 隔离闸使用。
 */
export function bodyWechatIdToParam(req: Request, _res: Response, next: NextFunction): void {
  const wid = typeof req.body?.wechat_id === 'string' ? req.body.wechat_id.trim() : '';
  req.params = { ...req.params, wechatId: wid };
  next();
}
