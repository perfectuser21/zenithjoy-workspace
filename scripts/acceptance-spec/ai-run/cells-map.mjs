/**
 * cells-map.mjs — AI员工采证映射（发版验收双表 · 刀2）
 *
 * 规程文件（acceptance-spec/line02-android.yaml）里 19 个 machine_db 格
 * → 各自的采证动作：走哪个后台页面、做什么、等多久。
 *
 * action 两值（D2 白名单收口）：
 *   trigger_collect  — 在任务页真实发起一次采集（全局 ≤2 次）
 *   observe          — 打开页面观察并截图
 *
 * 「这一格要不要特定现场」是规程的静态属性，SSOT 在 yaml 的 scenario_class
 * （mandatory 必须造场景 / unverifiable_this_version 本版不自动验），本文件不再复制一份。
 *
 * wait_budget_ms 里 300000(5分钟)/180000(3分钟) 来自规程时限格原文，不另造阈值。
 */

export const CELLS_MAP = [
  { id: 'S1-c3', route: '/area/acquisition/accounts', action: 'observe', wait_budget_ms: 60000,
    note: '常驻验收账号登录后在账号页观察绑定状态（截图含域名与登录态）' },

  { id: 'S4-c2', route: '/area/acquisition/accounts', action: 'observe', wait_budget_ms: 30000,
    note: '恢复时间窗需真机重启场景；无场景时判无法验证' },
  { id: 'S4-c3', route: '/area/acquisition/accounts', action: 'observe', wait_budget_ms: 30000,
    note: '「确实是这台测试机」需已知设备对照；截图设备列表为证' },

  { id: 'S5-c3', route: '/area/acquisition/accounts', action: 'observe', wait_budget_ms: 30000,
    note: '需小号掉线场景；观察是否有掉线号仍标可用' },
  { id: 'S5-c4', route: '/area/acquisition/accounts', action: 'observe', wait_budget_ms: 30000,
    note: '红线9/10：掉线派单/连坐需场景数据' },

  { id: 'S6-c3', route: '/area/acquisition/tasks', action: 'trigger_collect', wait_budget_ms: 60000,
    note: '真实发起采集后，任务记录须显示本轮关键词与正确归属' },
  { id: 'S6-c4', route: '/area/acquisition/tasks', action: 'observe', wait_budget_ms: 30000,
    note: '红线3：新账号任务列表只应出现自己的数据' },

  { id: 'S7-c1', route: '/area/acquisition/tasks', action: 'observe', wait_budget_ms: 300000,
    note: '任务须有明确终态；失败须有具体分类而非「未知错误」' },
  { id: 'S7-c2', route: '/area/acquisition/tasks', action: 'observe', wait_budget_ms: 300000,
    note: '5分钟内进入终态（预算=规程原文）' },

  { id: 'S8-c1', route: '/area/acquisition/tasks', action: 'observe', wait_budget_ms: 300000,
    note: '任务明细至少2条真实视频' },
  { id: 'S8-c3', route: '/area/acquisition/tasks', action: 'observe', wait_budget_ms: 300000,
    note: '视频编号为15位以上真实长编号' },
  { id: 'S8-c4', route: '/area/acquisition/tasks', action: 'observe', wait_budget_ms: 300000,
    note: '红线4：不得出现假编号/占位编号' },

  { id: 'S9-c1', route: '/area/acquisition/tasks', action: 'observe', wait_budget_ms: 180000,
    note: '至少1条视频判定离开「判定中」' },
  { id: 'S9-c2', route: '/area/acquisition/tasks', action: 'observe', wait_budget_ms: 180000,
    note: '3分钟内出判定结果（预算=规程原文）' },

  { id: 'S10-c1', route: '/area/acquisition/leads', action: 'observe', wait_budget_ms: 60000,
    note: '线索昵称/评论/目标身份可核验' },
  { id: 'S10-c4', route: '/area/acquisition/leads', action: 'trigger_collect', wait_budget_ms: 60000,
    note: '红线11：覆盖场景需两轮数据对照——二次 trigger_collect 同关键词复采' },

  { id: 'S11-c1', route: '/area/acquisition/outreach', action: 'observe', wait_budget_ms: 60000,
    note: '派单目标须来自本轮真实线索' },
  { id: 'S11-c3', route: '/area/acquisition/outreach', action: 'observe', wait_budget_ms: 60000,
    note: '红线2：账号/任务/线索/派单同链' },
  { id: 'S11-c4', route: '/area/acquisition/outreach', action: 'observe', wait_budget_ms: 30000,
    note: '红线3：不得出现其他客户的数据' },
];
