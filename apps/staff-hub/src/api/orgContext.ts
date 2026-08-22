/**
 * 多组织上下文 API 封装 —— 走知识中枢那条通道（只带会话 cookie，一个身份头都不拼）。
 *
 * org 的切换永远经服务端受校验地进行：前端只发 org_id，服务端据会话核对归属后落 active_org。
 * 绝不在请求里拼 X-Org-Id / X-Tenant-Id 之类身份头（服务端会当场触静态守卫报红）。
 */
import { knowledgeJson } from '../lib/knowledgeFetch';

export interface Org {
  org_id: string;
  name: string;
  role: string;
}

export interface OrgContextState {
  orgs: Org[];
  active_org_id: string | null;
  /** 归属 ≥2 家但当前未选 → true：前端必须先逼选，未选前不放进数据页 */
  needs_selection: boolean;
}

/** 拉当前员工的组织上下文（归属列表 + 当前 active + 是否必须先选）。 */
export function fetchOrgs(): Promise<OrgContextState> {
  return knowledgeJson<OrgContextState>('/api/knowledge/org');
}

/** 切换当前企业。返回服务端最终落定的 active_org_id（以它为准，不信前端传入值）。 */
export function switchOrg(orgId: string): Promise<{ active_org_id: string }> {
  return knowledgeJson<{ active_org_id: string }>('/api/knowledge/org/switch', {
    method: 'POST',
    body: JSON.stringify({ org_id: orgId }),
  });
}
