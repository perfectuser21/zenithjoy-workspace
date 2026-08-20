/**
 * /api/fields —— works 家族的自定义字段定义 CRUD（dashboard `/works/fields` 与
 * WorkDetailPage 的自定义字段编辑器在用）。
 *
 * G1 / J7 段①：这四个端点历史上**没有任何鉴权**，不带身份也返 2xx，任何人都能读改删
 * 全部租户的字段定义（洞记 issue 1ae57f1a，PR#1675 曾直接下线端点、#1676 因打断 dashboard
 * 又回滚）。正确的处置不是下线，是挂上 works 家族既有的租户闸——功能保住，越权关掉。
 *
 * 为什么挂 tenantContext 而不是路③ 那道会话闸：这张表归 works 家族，隔离列是 tenant_id，
 * 调用方（dashboard）走的也是家族既有的身份通道。两条路各走各的，谁都别动谁。
 */
import { Router } from 'express';
import { FieldsController } from '../controllers/fields.controller';
import { validate } from '../middleware/validate';
import { tenantContext } from '../middleware/tenant-context';
import { createFieldSchema, updateFieldSchema } from '../models/schemas';

const router = Router();
const controller = new FieldsController();

// 四个端点一律先过租户闸：无身份 → 401，有身份无租户 → 403。
// 挂在 router 顶层而不是逐个端点，是为了让"以后新增端点忘了加闸"这件事不可能发生。
router.use(tenantContext);

// GET /api/fields - List fields
router.get('/', controller.getFields);

// POST /api/fields - Create field
router.post('/', validate(createFieldSchema), controller.createField);

// PUT /api/fields/:id - Update field
router.put('/:id', validate(updateFieldSchema), controller.updateField);

// DELETE /api/fields/:id - Delete field
router.delete('/:id', controller.deleteField);

export default router;
