/**
 * 轻量全局草稿哨兵 —— 让「有没有正在编辑、尚未提交的草稿」这件事能被跨组件读到。
 *
 * 为什么不放进某个 React state：判断草稿是否存在的一方是 AuthContext 的 BroadcastChannel
 * 回调（别的标签页切了企业），而产生草稿的一方是深埋在表格里的 WorkbenchRowGrid。两者没有
 * 父子关系，用一个模块级注册表最省事，也不会因为 provider 层级变化而失效。
 *
 * 用 Set<key> 而不是单个布尔：同一时刻理论上可以有多处在编辑（虽然当前只有工作台一处），
 * key 让每个来源各自登记/注销，互不覆盖。
 */
const dirtyKeys = new Set<string>();

/** 登记/注销某来源的草稿脏态。dirty=true 记上，false 抹掉。 */
export function markDraftDirty(key: string, dirty: boolean): void {
  if (dirty) dirtyKeys.add(key);
  else dirtyKeys.delete(key);
}

/** 当前是否存在任何未提交草稿。 */
export function hasUnsavedDraft(): boolean {
  return dirtyKeys.size > 0;
}

/** 用户明确「放弃草稿」后清空所有登记（切企业整页重拉前调用）。 */
export function clearAllDrafts(): void {
  dirtyKeys.clear();
}
