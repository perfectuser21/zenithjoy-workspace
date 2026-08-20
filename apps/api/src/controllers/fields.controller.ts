import { Request, Response, NextFunction } from 'express';
import { FieldsService } from '../services/fields.service';

const fieldsService = new FieldsService();

/**
 * 租户归属只取 tenantContext 解析出来的 req.tenantId —— 不看请求体、不看查询串。
 * 拿不到就让 service 层 fail-closed（403），绝不退化成查全表。
 */
function tenantOf(req: Request): string {
  return req.tenantId ?? '';
}

export class FieldsController {
  async getFields(req: Request, res: Response, next: NextFunction) {
    try {
      const fields = await fieldsService.getFields(tenantOf(req));
      res.json(fields);
    } catch (error) {
      next(error);
    }
  }

  async createField(req: Request, res: Response, next: NextFunction) {
    try {
      const field = await fieldsService.createField(req.body, tenantOf(req));
      res.status(201).json(field);
    } catch (error) {
      next(error);
    }
  }

  async updateField(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const field = await fieldsService.updateField(id, req.body, tenantOf(req));
      res.json(field);
    } catch (error) {
      next(error);
    }
  }

  async deleteField(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await fieldsService.deleteField(id, tenantOf(req));
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
}
