import { Router } from 'express';
import { listSkills, getAllAgentSkillStatuses } from '../services/skill-db';

export const skillsRouter = Router();

// GET /api/skills — 返回全部 active skill + 各 agent 的状态
skillsRouter.get('/', async (req, res, next) => {
  try {
    const [skills, statuses] = await Promise.all([
      listSkills(),
      getAllAgentSkillStatuses(),
    ]);

    const statusMap: Record<string, Record<string, { status: string; last_error: string | null; last_check: string }>> = {};
    for (const s of statuses) {
      if (!statusMap[s.skill_slug]) statusMap[s.skill_slug] = {};
      statusMap[s.skill_slug][s.agent_id] = {
        status: s.status,
        last_error: s.last_error,
        last_check: s.last_check,
      };
    }

    const result = skills.map((skill) => ({
      ...skill,
      agent_statuses: statusMap[skill.slug] ?? {},
    }));

    res.json({ skills: result });
  } catch (err) {
    next(err);
  }
});
