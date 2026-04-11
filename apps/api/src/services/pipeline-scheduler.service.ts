/**
 * Pipeline Scheduler Service
 *
 * zenithjoy 侧 pipeline 自动调度 —— 替代 cecelia tick 的自主触发逻辑。
 * 在服务启动时初始化，按配置的时间窗口触发内容 pipeline。
 *
 * 环境变量：
 *   PIPELINE_SCHEDULER_ENABLED=true     启用调度（默认 false，需显式开启）
 *   PIPELINE_DAILY_COUNT=5              每日目标产出数量（默认 5）
 *   PIPELINE_CONTENT_TYPES=tech_insight,solo-company-case  逗号分隔的内容类型
 *   PIPELINE_TRIGGER_HOUR=9             每日触发小时（北京时间，默认 9）
 *   CECELIA_BRAIN_URL=http://localhost:5221
 */

const SCHEDULER_ENABLED = process.env.PIPELINE_SCHEDULER_ENABLED === 'true';
const DAILY_COUNT = parseInt(process.env.PIPELINE_DAILY_COUNT || '5', 10);
const CONTENT_TYPES = (process.env.PIPELINE_CONTENT_TYPES || 'solo-company-case').split(',').map(s => s.trim());
const TRIGGER_HOUR = parseInt(process.env.PIPELINE_TRIGGER_HOUR || '9', 10);
const ZENITHJOY_API_URL = process.env.ZENITHJOY_API_URL || 'http://localhost:3001';

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let lastTriggerDate: string | null = null;

function getTodayBJT(): string {
  return new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function getCurrentHourBJT(): number {
  return parseInt(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai', hour: 'numeric', hour12: false }),
    10
  );
}

async function triggerDailyPipelines(): Promise<void> {
  const today = getTodayBJT();
  if (lastTriggerDate === today) {
    console.log('[pipeline-scheduler] 今日已触发，跳过');
    return;
  }

  const hour = getCurrentHourBJT();
  if (hour < TRIGGER_HOUR) {
    return; // 还没到触发时间
  }

  console.log(`[pipeline-scheduler] 触发今日 pipeline，目标数量: ${DAILY_COUNT}，内容类型: ${CONTENT_TYPES.join(',')}`);
  lastTriggerDate = today;

  let successCount = 0;
  for (let i = 0; i < DAILY_COUNT; i++) {
    const contentType = CONTENT_TYPES[i % CONTENT_TYPES.length];
    try {
      const res = await fetch(`${ZENITHJOY_API_URL}/api/pipeline/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content_type: contentType,
          triggered_by: 'scheduler',
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        successCount++;
        console.log(`[pipeline-scheduler] pipeline ${i + 1}/${DAILY_COUNT} 触发成功 (${contentType})`);
      } else {
        console.warn(`[pipeline-scheduler] pipeline ${i + 1}/${DAILY_COUNT} 触发失败: ${res.status}`);
      }
    } catch (err) {
      console.error(`[pipeline-scheduler] pipeline ${i + 1} 触发异常: ${(err as Error).message}`);
    }
    // 错开触发，避免并发冲击
    if (i < DAILY_COUNT - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log(`[pipeline-scheduler] 今日 pipeline 触发完成: ${successCount}/${DAILY_COUNT} 成功`);
}

export function startPipelineScheduler(): void {
  if (!SCHEDULER_ENABLED) {
    console.log('[pipeline-scheduler] 未启用（设置 PIPELINE_SCHEDULER_ENABLED=true 开启）');
    return;
  }

  console.log(`[pipeline-scheduler] 启动，每日 ${TRIGGER_HOUR}:00 BJ 触发 ${DAILY_COUNT} 条 pipeline`);

  // 每 30 分钟检查一次是否该触发
  schedulerInterval = setInterval(() => {
    triggerDailyPipelines().catch(err =>
      console.error('[pipeline-scheduler] 触发异常:', err)
    );
  }, 30 * 60 * 1000);

  // 启动时立即检查一次
  triggerDailyPipelines().catch(err =>
    console.error('[pipeline-scheduler] 启动时触发异常:', err)
  );
}

export function stopPipelineScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[pipeline-scheduler] 已停止');
  }
}
