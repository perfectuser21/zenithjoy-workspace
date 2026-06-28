/**
 * apps/dashboard/src/api/wechat-cs-config.api.ts — 微信客服中台配置 API 客户端
 *
 * 对接 Path 4 Sprint B 后端 /api/wechat/* 路由（人设 + 企业知识库 CRUD + AI 帮填人群）。
 * 类型与后端 apps/api/src/services/wechat/types.ts 对齐。
 * apiClient baseURL 已是 /api，自动带 cookie + X-Feishu-User-Id 头。
 */
import { apiClient } from './client';

// ─── 类型（对齐后端 types.ts）────────────────────────────────────

export interface PersonaFewShot {
  customer: string; // 客户这么说
  me: string; // 我会这么回
}

export interface Persona {
  self_name: string; // 我的自称
  address_style: string; // 怎么称呼客户
  tone: string; // 语气基调
  sentence_style: string; // 句长 / 拆句偏好
  use_emoji: string; // emoji 使用习惯
  banned_phrases: string[]; // 禁用词 / 禁用腔
  few_shot: PersonaFewShot[];
}

export interface KBCompany {
  name: string;
  what_we_do: string;
  value_prop: string;
  contact: string;
}

export interface KBProduct {
  name: string;
  selling_points: string;
  price?: string;
}

export interface KBAudienceSegment {
  code: string; // A1 / A2 / ...
  label: string;
  desc: string;
}

export interface KBQADoc {
  q: string;
  a: string;
}

export interface BusinessKB {
  company: KBCompany;
  products: KBProduct[];
  audience_segments: KBAudienceSegment[];
  qa_docs: KBQADoc[];
}

export interface SuggestAudienceInput {
  industry: string;
  products?: string;
  value_prop?: string;
}

// ─── 客服号（machine→wechat_id 绑定）+ 每号配置（IA 重设计刀1）──────────────────

// 客服号列表项（GET /wechat/cs/machines，已按账号租户 scope：运营只看自己的号，超管看全部）
export interface CSMachine {
  machine_id: string;
  hostname?: string;
  configured: boolean;
  wechat_id?: string; // 该号配置主 key（= 每号 persona/business_kb 读写 key）
  real_wechat_id?: string; // 真实微信号（perfect-xx）
  self_name?: string; // 该号人设名（快速标签）
  online?: boolean;
  // 健康 + 运营态（后端 listAllMachines 一并返回，供「客服号总览」/「单号工作台」状态条用）
  auto_agent_enabled?: boolean; // 真发(true)/演练(false)
  wechat_ok?: boolean; // 微信整体健康
  wechat_reason?: string; // 不健康原因
  found_window?: boolean; // 找到微信主窗口（已登录）
  login_present?: boolean; // 检测到扫码登录界面（需扫码）
  agent_id?: string; // license_machines.agent_id，匹配监听心跳用
}

// 每号完整配置（GET /wechat/cs/config/:wechatId）
export interface CSAccountConfig {
  wechat_id: string;
  persona: Persona;
  business_kb: BusinessKB;
  auto_agent_enabled?: boolean;
  business_hours_start?: string;
  business_hours_end?: string;
  daily_limit?: number;
  whitelist?: string[];
}

// ─── 监听健康（Agent listen_chat.py 心跳）────────────────────────
// 对齐后端 GET /api/wechat/listener-heartbeat。diag 可能整体缺失或字段缺失，全部可选。

export interface ListenerDiag {
  main_window_found?: boolean; // 找到微信主窗口
  login_present?: boolean; // 检测到扫码登录界面
  sessions_seen?: number; // 看到的会话数
  unread_count?: number; // 未读会话数
  unread_senders?: string[]; // 有未读的发件人
  replied_count?: number; // 本轮已回复条数
  last_error?: string | null; // 最后报的错
}

export interface ListenerStatus {
  agent_id: string | null;
  wechat_id: string | null;
  ts: number; // 服务端最后收到心跳的 ms 时间戳
  diag?: ListenerDiag; // 整体可能缺失
}

// ─── API 函数 ────────────────────────────────────────────────────

export const wechatCsConfigApi = {
  // 人设
  getPersona: async () => {
    const res = await apiClient.get<Persona>('/wechat/persona');
    return res.data;
  },

  savePersona: async (persona: Persona) => {
    const res = await apiClient.put<{ success: boolean }>('/wechat/persona', persona);
    return res.data;
  },

  // 企业知识库
  getBusinessKB: async () => {
    const res = await apiClient.get<BusinessKB>('/wechat/business-kb');
    return res.data;
  },

  saveBusinessKB: async (kb: BusinessKB) => {
    const res = await apiClient.put<{ success: boolean }>('/wechat/business-kb', kb);
    return res.data;
  },

  // AI 帮填 A1–A5 人群画像
  suggestAudience: async (input: SuggestAudienceInput) => {
    const res = await apiClient.post<{ audience_segments: KBAudienceSegment[] }>(
      '/wechat/business-kb/suggest-audience',
      input
    );
    return res.data;
  },

  // ── 每号配置（IA 重设计刀1）──
  // 列出当前账号可见的客服号（运营只看自己的号，超管看全部 = 既有 scope）
  listCSMachines: async (): Promise<CSMachine[]> => {
    const res = await apiClient.get<{ machines?: CSMachine[] }>('/wechat/cs/machines');
    return res.data?.machines ?? [];
  },

  // 读某个号的完整 persona + business_kb（404 → null，前端用空默认）
  getCSAccountConfig: async (wechatId: string): Promise<CSAccountConfig | null> => {
    try {
      const res = await apiClient.get<CSAccountConfig>(
        `/wechat/cs/config/${encodeURIComponent(wechatId)}`
      );
      return res.data;
    } catch {
      return null; // 该号尚无配置（404）→ 前端填空表
    }
  },

  // 保存某个号的 persona + business_kb（行级 merge：不传运营参数不清空它们）
  saveCSAccountConfig: async (
    wechatId: string,
    body: { persona: Persona; business_kb: BusinessKB }
  ) => {
    const res = await apiClient.put<{ success: boolean }>(
      `/wechat/cs/config/${encodeURIComponent(wechatId)}`,
      body
    );
    return res.data;
  },

  // 客户机 Agent 监听心跳（listen_chat.py 每分钟上报）
  getListenerStatus: async (): Promise<ListenerStatus[]> => {
    const res = await apiClient.get<{ listeners?: ListenerStatus[] }>(
      '/wechat/listener-heartbeat'
    );
    return res.data?.listeners ?? [];
  },
};

// 命名导出，便于页面直接解构
export const {
  getPersona,
  savePersona,
  getBusinessKB,
  saveBusinessKB,
  suggestAudience,
  getListenerStatus,
  listCSMachines,
  getCSAccountConfig,
  saveCSAccountConfig,
} = wechatCsConfigApi;
