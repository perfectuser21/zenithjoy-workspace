import { Router } from 'express';
import { createTask, getTask, listTasks } from '../services/task-db';
import { dispatchTask } from '../services/task-dispatch';

export const tasksRouter = Router();

tasksRouter.post('/', async (req, res, next) => {
  try {
    const { tenantId, skill, params = {} } = req.body;
    if (!tenantId || !skill) {
      return res.status(400).json({ error: 'tenantId and skill are required' });
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
    const { tenantId } = req.query;
    if (!tenantId || typeof tenantId !== 'string') {
      return res.status(400).json({ error: 'tenantId query param required' });
    }
    const tasks = await listTasks(tenantId);
    return res.json({ tasks });
  } catch (err) {
    next(err);
  }
});

// Require tenantId to prevent IDOR across tenants
tasksRouter.get('/:id', async (req, res, next) => {
  try {
    const { tenantId } = req.query;
    if (!tenantId || typeof tenantId !== 'string') {
      return res.status(400).json({ error: 'tenantId query param required' });
    }
    const task = await getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'not found' });
    if (task.tenantId !== tenantId) return res.status(403).json({ error: 'forbidden' });
    return res.json({ task });
  } catch (err) {
    next(err);
  }
});
