import { Router } from 'express';
import { FieldsController } from '../controllers/fields.controller';
import { validate } from '../middleware/validate';
import { createFieldSchema, updateFieldSchema } from '../models/schemas';

const router = Router();
const controller = new FieldsController();

// GET /api/fields - List fields
router.get('/', controller.getFields);

// POST /api/fields - Create field
router.post('/', validate(createFieldSchema), controller.createField);

// PUT /api/fields/:id - Update field
router.put('/:id', validate(updateFieldSchema), controller.updateField);

// DELETE /api/fields/:id - Delete field
router.delete('/:id', controller.deleteField);

export default router;
