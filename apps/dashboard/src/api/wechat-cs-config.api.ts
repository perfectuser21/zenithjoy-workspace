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
};

// 命名导出，便于页面直接解构
export const {
  getPersona,
  savePersona,
  getBusinessKB,
  saveBusinessKB,
  suggestAudience,
} = wechatCsConfigApi;
