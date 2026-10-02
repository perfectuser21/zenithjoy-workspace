// Brain固定AV规范化产物：runtime、execution.via和Step implementation只保留原声明。
// 来自真实关键词契约；无机器调用，不能作为verified可执行组件。
export const normalizedDescriptions=[
  {
    "raw": {
      "args": "PROFILE SOURCE_ENC MAXV TAG LOC → stdout 每行 X\tY\tDUR\tTITLE；无卡 exit 0 空输出；失败 exit 1",
      "entry": "discover-keyword.sh",
      "phase": "source"
    },
    "kind": "raw",
    "field": "runtime",
    "scope": "activity",
    "status": "unresolved"
  },
  {
    "raw": "xian-m4 batch2.sh:78 → harvest-keyword.sh:35-43 → douyin-phone-adb",
    "kind": "raw",
    "field": "execution.via",
    "scope": "activity",
    "status": "unresolved"
  },
  {
    "raw": {
      "ref": "harvest-keyword.sh:35 open-search",
      "status": "implemented"
    },
    "kind": "raw",
    "field": "implementation",
    "scope": "step",
    "status": "unresolved",
    "step_key": "open_search"
  }
];
