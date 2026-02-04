/**
 * AI 员工配置
 *
 * 把 n8n 工作流抽象成「AI 员工」概念，按部门组织，隐藏技术细节
 */

// 图标类型（lucide-react 图标名称）
export type IconName =
  | 'Monitor' | 'Code' | 'Wallet'  // 部门图标
  | 'Video' | 'BarChart3' | 'Wrench' | 'User';  // 员工图标

// 职能
export interface AiAbility {
  id: string;
  name: string;
  description?: string;
  workflowKeywords: string[];  // 匹配 n8n workflow 名称
}

// 员工
export interface AiEmployee {
  id: string;
  name: string;
  icon: IconName;  // lucide 图标名称
  role: string;
  description?: string;
  abilities: AiAbility[];
}

// 部门
export interface Department {
  id: string;
  name: string;
  icon: IconName;  // lucide 图标名称
  description?: string;
  employees: AiEmployee[];
}

// ============ 初始配置 ============

export const AI_DEPARTMENTS: Department[] = [
  {
    id: 'media',
    name: '新媒体部',
    icon: 'Monitor',
    description: '负责社交媒体账号运营和内容发布',
    employees: [
      {
        id: 'xiaoyun',
        name: '小运',
        icon: 'Video',
        role: '内容运营专员',
        description: '负责各平台账号的登录管理和内容发布',
        abilities: [
          {
            id: 'login',
            name: '账号登录',
            description: '管理平台账号登录状态',
            workflowKeywords: ['登录', 'login', 'Login', 'VNC', 'vnc']
          },
          {
            id: 'publish',
            name: '内容发布',
            description: '执行内容发布任务',
            workflowKeywords: ['发布', 'publish', 'Publish', 'post', 'Post']
          }
        ]
      },
      {
        id: 'xiaoxi',
        name: '小析',
        icon: 'BarChart3',
        role: '数据分析师',
        description: '负责数据采集和分析任务',
        abilities: [
          {
            id: 'scrape',
            name: '数据采集',
            description: '从各平台采集数据',
            workflowKeywords: ['爬取', 'scrape', 'Scrape', 'scraping', 'Scraping', '采集']
          },
          {
            id: 'analytics',
            name: '数据分析',
            description: '分析数据并生成报告',
            workflowKeywords: ['分析', 'analytics', 'Analytics', '统计', 'stats', 'Stats']
          }
        ]
      }
    ]
  },
  {
    id: 'tech',
    name: '技术部',
    icon: 'Code',
    description: '负责技术支持和系统维护',
    employees: [
      {
        id: 'xiaowei',
        name: '小维',
        icon: 'Wrench',
        role: '技术运维专员',
        description: '负责 AI 任务调度和系统维护',
        abilities: [
          {
            id: 'claude',
            name: 'AI 任务',
            description: '执行 Claude AI 相关任务',
            workflowKeywords: ['claude', 'Claude', 'AI', 'ai', 'GPT', 'gpt']
          },
          {
            id: 'maintenance',
            name: '系统维护',
            description: '定时维护和清理任务',
            workflowKeywords: ['maintenance', 'Maintenance', 'nightly', 'Nightly', '维护', '清理', 'cleanup', 'Cleanup']
          }
        ]
      }
    ]
  },
  {
    id: 'finance',
    name: '财务部',
    icon: 'Wallet',
    description: '预留部门',
    employees: []  // 预留
  }
];

// ============ 辅助函数 ============

/**
 * 根据工作流名称匹配员工
 */
export function matchEmployeeByWorkflow(workflowName: string): AiEmployee | null {
  for (const dept of AI_DEPARTMENTS) {
    for (const employee of dept.employees) {
      for (const ability of employee.abilities) {
        if (ability.workflowKeywords.some(keyword =>
          workflowName.toLowerCase().includes(keyword.toLowerCase())
        )) {
          return employee;
        }
      }
    }
  }
  return null;
}

/**
 * 根据工作流名称匹配职能
 */
export function matchAbilityByWorkflow(workflowName: string): { employee: AiEmployee; ability: AiAbility } | null {
  for (const dept of AI_DEPARTMENTS) {
    for (const employee of dept.employees) {
      for (const ability of employee.abilities) {
        if (ability.workflowKeywords.some(keyword =>
          workflowName.toLowerCase().includes(keyword.toLowerCase())
        )) {
          return { employee, ability };
        }
      }
    }
  }
  return null;
}

/**
 * 获取所有员工
 */
export function getAllEmployees(): AiEmployee[] {
  return AI_DEPARTMENTS.flatMap(dept => dept.employees);
}

/**
 * 根据员工 ID 获取员工
 */
export function getEmployeeById(id: string): AiEmployee | null {
  for (const dept of AI_DEPARTMENTS) {
    const employee = dept.employees.find(e => e.id === id);
    if (employee) return employee;
  }
  return null;
}

/**
 * 根据员工 ID 获取所属部门
 */
export function getDepartmentByEmployeeId(employeeId: string): Department | null {
  for (const dept of AI_DEPARTMENTS) {
    if (dept.employees.some(e => e.id === employeeId)) {
      return dept;
    }
  }
  return null;
}
