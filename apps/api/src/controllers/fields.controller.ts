import { Request, Response, NextFunction } from 'express';
import { FieldsService } from '../services/fields.service';

const fieldsService = new FieldsService();

export class FieldsController {
  async getFields(req: Request, res: Response, next: NextFunction) {
    try {
      const fields = await fieldsService.getFields();
      res.json(fields);
    } catch (error) {
      next(error);
    }
  }

  async createField(req: Request, res: Response, next: NextFunction) {
    try {
      const field = await fieldsService.createField(req.body);
      res.status(201).json(field);
    } catch (error) {
      next(error);
    }
  }

  async updateField(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const field = await fieldsService.updateField(id, req.body);
      res.json(field);
    } catch (error) {
      next(error);
    }
  }

  async deleteField(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await fieldsService.deleteField(id);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
}
