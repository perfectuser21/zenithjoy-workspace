import { Router, Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { superAdminGuard } from '../middleware/super-admin';

const router = Router();
router.use(superAdminGuard);

const PLATFORM_MAP: Record<string, string> = {
  DOUYIN:       '抖音',
  KUAISHOU:     '快手',
  XIAOHONGSHU:  '小红书',
  SHIPINHAO:    '视频号',
  TOUTIAO:      '头条',
  WEIBO:        '微博',
  ZHIHU:        '知乎',
  GONGZHONGHAO: '公众号',
};

const API_KEY_MARKERS = ['API_KEY', 'WEBHOOK', 'TOKEN'];

interface HealthRecord {
  platform: string;
  secretEnv: string;
  status: string;
  checkedAt: string | null;
  expiresAt: string | null;
}

type CellStatus = 'ok' | 'expired' | 'missing';
interface MatrixCell { status: CellStatus; lastSync: string | null; }
type Matrix = Record<string, Record<string, MatrixCell>>;

function formatDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${day} ${h}:${min}`;
}

function buildMatrix(records: HealthRecord[]): Matrix {
  const matrix: Matrix = {};
  for (const r of records) {
    if (API_KEY_MARKERS.some(m => r.secretEnv.includes(m))) continue;
    let platformName: string | null = null;
    let accountType: string | null = null;
    for (const [prefix, name] of Object.entries(PLATFORM_MAP)) {
      if (r.secretEnv.startsWith(prefix + '_')) {
        platformName = name;
        accountType = r.secretEnv.slice(prefix.length + 1);
        break;
      }
    }
    if (!platformName || !accountType) continue;
    if (!matrix[platformName]) matrix[platformName] = {};
    matrix[platformName][accountType] = {
      status: (r.status as CellStatus) ?? 'missing',
      lastSync: r.checkedAt ? formatDate(r.checkedAt) : null,
    };
  }
  return matrix;
}

function loadReport(): HealthRecord[] {
  const reportPath = join(process.cwd(), 'session-health-report.json');
  try {
    const raw = readFileSync(reportPath, 'utf-8');
    return JSON.parse(raw) as HealthRecord[];
  } catch (e: unknown) {
    console.warn('[operator] session-health-report.json unavailable:', (e as Error).message);
    return [];
  }
}

router.post('/sessions/sync', (_req: Request, res: Response) => {
  const records = loadReport();
  const matrix = buildMatrix(records);
  res.json({ matrix });
});

export const operatorRouter = router;
