'use strict';
// CJS shim for sprint vitest require() — production code uses .ts
Object.defineProperty(exports, '__esModule', { value: true });

/**
 * 按取模轮询从 ASSIGNEE_ROSTER 分配负责人。名单为空返 null。
 */
function pickAssignee(roster, dayLeadCount) {
  if (!Array.isArray(roster) || roster.length === 0) return null;
  return roster[dayLeadCount % roster.length];
}

exports.pickAssignee = pickAssignee;
