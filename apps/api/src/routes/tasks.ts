import { Router } from 'express';
import { createTask, getTask, listTasks } from '../services/task-db';
import { dispatchTask } from '../services/task-dispatch';
import { tenantContext } from '../middleware/tenant-context';

export const tasksRouter = Router();
tasksRouter.use(tenantContext);

tasksRouter.post('/', async (req, res, next) => {
  try {
    const { tenantId: hint, skill, params = {} } = req.body;
    const tenantId = req.tenantId!;
    if (hint !== undefined && hint !== tenantId) return res.status(403).json({ error: 'forbidden' });
    if (typeof skill !== 'string' || !skill.trim()) {
      return res.status(400).json({ error: 'skill is required' });
    }
    const task = await createTask({ tenantId, skill, params });
    dispatchTask(task).catch((e) => console.warn('[tasks] dispatchTask failed:', e));
    return res.status(201).json({ task });
  } catch (err) {
    next(err);
  }
});

tasksRouter.get('/', async (req, res, next) => {
  try {
    const tenantId = req.tenantId!;
    if (req.query.tenantId !== undefined && req.query.tenantId !== tenantId) return res.status(403).json({ error: 'forbidden' });
    const tasks = await listTasks(tenantId);
    return res.json({ tasks });
  } catch (err) {
    next(err);
  }
});

// Derive tenancy from the resolved identity; request hints never authorize access.
tasksRouter.get('/:id', async (req, res, next) => {
  try {
    const tenantId = req.tenantId!;
    if (req.query.tenantId !== undefined && req.query.tenantId !== tenantId) return res.status(403).json({ error: 'forbidden' });
    const task = await getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'not found' });
    if (task.tenantId !== tenantId) return res.status(404).json({ error: 'not found' });
    return res.json({ task });
  } catch (err) {
    next(err);
  }
});
