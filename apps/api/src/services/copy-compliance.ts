// apps/api/src/services/copy-compliance.ts
//
// 批量混剪文案合规检查（GP line05/batch_mashup#step4）。
//
// 背景：批量混剪即将把客户文案 TTS 念出来 + 烧成字幕上线。现有内容安全 Gate
// （mashup-render.ts 的 buildSafetyPrompt）只审画面首帧（色情/暴力/水印），
// 完全不审文案。客户是农药/卫生杀虫剂类目（蟑螂药），一旦"根治""无毒无害"
// "三天彻底消灭"这类极限词/违规宣称从"藏在文案里没人看"变成"念出来+写在
// 屏幕上"，触发的是账号级处罚（比视频没人看严重得多）。
// 更麻烦的是文案分段本身用 AI 生成（mashup-slot-assignment.ts 的
// generateTemplateFromScript），AI 自己就容易生成这类词，系统必须能拦住。
//
// 设计取舍：纯本地词库匹配，不调 AI。理由——
//   1. 这是确定性规则（词库=已知违禁词），本地正则比调 AI 快且稳定可测试；
//   2. AI 本身就是违规词的来源之一，用 AI 去审 AI 生成的内容，风险闭环没打开；
//   3. 词库可被单测精确锁定（see __tests__/copy-compliance.test.ts），
//      AI 判断做不到这种确定性回归保护。
//
// 变体规避覆盖边界（写清楚，不做正则地狱）：
//   - 覆盖：中间插入常见分隔符（空格/中横线/点/顿号/逗号等，至多连续 2 个）——
//     如"最 佳""无 毒 无 害"；全角 ASCII（Ａ-Ｚ/０-９/％等）与全角空格自动
//     折算为半角；带圈数字 ①-⑨ 折算为阿拉伯数字（因此"第①"能命中"第1"）；
//     英文词大小写不敏感。
//   - 不覆盖：拼音/同音字替代（如"跟治"）、生僻字形近替代、图片文字、
//     每个字之间插入 3 个以上噪音字符、简繁混排导致的用字差异。这些需要
//     拼音归一化或 OCR/语义层面的能力，超出"确定性本地规则"这一档的设计目标，
//     真出现规避需要升级到语义审核（比如喂进现有的画面安全 Gate 一起过 AI）。
//   - 位置计算基于全角/带圈数字归一化后的字符串（归一化是逐字符 1:1 替换，
//     不改变长度），因此仅对 BMP 范围内的字符准确；文案中出现 emoji 等
//     代理对（surrogate pair）字符会导致位置轻微偏移，蟑螂药文案场景概率极低。

/** 合规问题分类。 */
export const CATEGORY_ABSOLUTE = '绝对化用语';
export const CATEGORY_PESTICIDE = '农药高危宣称';
export const CATEGORY_MEDICAL = '医疗功效暗示';
export const CATEGORY_TIMELINESS = '时效承诺';

export interface ComplianceIssue {
  /** 命中的词（取自原文，保留用户实际写的变体形态） */
  term: string;
  /** 分类：绝对化用语 / 农药高危宣称 / 医疗功效暗示 / 时效承诺 */
  category: string;
  /** 命中词在原文中的起始字符位置（从 0 开始） */
  position: number;
  /** 可选的替换建议 */
  suggestion?: string;
}

export interface ComplianceResult {
  passed: boolean;
  issues: ComplianceIssue[];
}

interface ComplianceTerm {
  term: string;
  category: string;
  suggestion?: string;
}

// ─── 词库 ──────────────────────────────────────────────────────────────────
//
// 每一类词库都有法规或平台规则依据，不是凭感觉堆词。新增词前先确认属于
// 下面四类中的哪一类、依据是什么，写进对应分组的注释里。

/**
 * 1. 绝对化用语 —— 依据《中华人民共和国广告法》第九条：
 *    广告不得使用"国家级""最高级""最佳"等用语。这是全品类通用红线，
 *    不限于农药/卫生杀虫剂，蟑螂药文案同样适用。
 */
const ABSOLUTE_TERMS: ComplianceTerm[] = [
  { term: '国家级', category: CATEGORY_ABSOLUTE, suggestion: '删除，改为具体资质/认证名称' },
  { term: '最高级', category: CATEGORY_ABSOLUTE, suggestion: '改为具体参数对比' },
  { term: '最佳', category: CATEGORY_ABSOLUTE, suggestion: '改为"热门/优质"等非排他表述' },
  { term: '第一', category: CATEGORY_ABSOLUTE, suggestion: '改为"畅销/热销"，避免排名断言' },
  { term: '第1', category: CATEGORY_ABSOLUTE, suggestion: '改为"畅销/热销"，避免排名断言' },
  { term: '顶级', category: CATEGORY_ABSOLUTE, suggestion: '改为"优质"' },
  { term: '顶尖', category: CATEGORY_ABSOLUTE, suggestion: '改为"优质"' },
  { term: '极致', category: CATEGORY_ABSOLUTE, suggestion: '改为"出色/显著"' },
  { term: '唯一', category: CATEGORY_ABSOLUTE, suggestion: '删除排他性表述' },
  { term: '独家', category: CATEGORY_ABSOLUTE, suggestion: '如无法举证请删除' },
  { term: '首选', category: CATEGORY_ABSOLUTE, suggestion: '改为"可选/推荐"' },
  { term: '史无前例', category: CATEGORY_ABSOLUTE, suggestion: '删除夸大表述' },
  { term: '万能', category: CATEGORY_ABSOLUTE, suggestion: '改为具体适用场景' },
  { term: '终极', category: CATEGORY_ABSOLUTE, suggestion: '删除夸大表述' },
];

/**
 * 2. 农药高危宣称 —— 依据《农药管理条例》第三十九条（农药广告不得含有
 *    虚假或者引人误解的内容，不得明示或者暗示对人畜安全无毒副作用）
 *    及各平台（抖音/快手/淘宝等）对农药/卫生杀虫剂类目内容安全规则中
 *    列明的高危词表（"根治""彻底消灭""无毒无害"等属高发违规/处罚案例词）。
 *    这一类是本次上线风险最集中的地方——文案分段 AI 最容易脱口而出这些词。
 */
const PESTICIDE_HIGH_RISK_TERMS: ComplianceTerm[] = [
  { term: '根治', category: CATEGORY_PESTICIDE, suggestion: '改为"有效抑制/持续控制"等可验证表述' },
  { term: '彻底消灭', category: CATEGORY_PESTICIDE, suggestion: '改为"有效杀灭"' },
  { term: '永不复发', category: CATEGORY_PESTICIDE, suggestion: '改为"配合定期使用可减少复发"' },
  { term: '无毒无害', category: CATEGORY_PESTICIDE, suggestion: '改为"低毒/符合国家农药登记安全标准"' },
  { term: '绝对安全', category: CATEGORY_PESTICIDE, suggestion: '改为"按说明书使用更安心"' },
  { term: '100%', category: CATEGORY_PESTICIDE, suggestion: '改为"显著提升/大幅提高"' },
  { term: '斩草除根', category: CATEGORY_PESTICIDE, suggestion: '改为"有效杀灭"' },
  { term: '一次根除', category: CATEGORY_PESTICIDE, suggestion: '改为"配合持续使用效果更佳"' },
  { term: '除虫务尽', category: CATEGORY_PESTICIDE, suggestion: '改为"有效杀灭"' },
  { term: '不留活口', category: CATEGORY_PESTICIDE, suggestion: '改为"有效杀灭"' },
  { term: '断根', category: CATEGORY_PESTICIDE, suggestion: '改为"有效抑制"' },
  { term: '绝迹', category: CATEGORY_PESTICIDE, suggestion: '改为"明显减少"' },
];

/**
 * 3. 医疗功效暗示 —— 依据《广告法》第十七条：除医疗、药品、医疗器械广告外，
 *    其他广告不得涉及疾病治疗功能，不得使用医疗用语或者易与药品、医疗器械
 *    相混淆的用语。蟑螂药是卫生杀虫剂而非药品/医疗器械，不能用"治疗/疗效"
 *    类字眼。
 */
const MEDICAL_EFFICACY_TERMS: ComplianceTerm[] = [
  { term: '治疗', category: CATEGORY_MEDICAL, suggestion: '删除医疗用语，改为"缓解/改善环境卫生"' },
  { term: '疗效', category: CATEGORY_MEDICAL, suggestion: '删除医疗用语' },
  { term: '药到病除', category: CATEGORY_MEDICAL, suggestion: '删除医疗用语' },
  { term: '包治', category: CATEGORY_MEDICAL, suggestion: '删除医疗用语' },
  { term: '根治百病', category: CATEGORY_MEDICAL, suggestion: '删除医疗用语' },
  { term: '特效药', category: CATEGORY_MEDICAL, suggestion: '改为"高效产品"，避免"药"的医疗暗示' },
  { term: '处方级', category: CATEGORY_MEDICAL, suggestion: '删除医疗资质暗示' },
];

/**
 * 4. 时效承诺 —— 依据《广告法》第四条（广告不得含有虚假或者引人误解的
 *    内容，不得欺骗、误导消费者）：缺乏科学依据、不可验证的时效保证
 *    （"三天见效""当天灭绝"）是平台内容安全规则重点打击的虚假宣传形态。
 *    注意：本类仅覆盖"具体时间点+断言式效果"的组合，避免误伤"一喷就
 *    见效"这类常规、模糊的卖点表述（不构成可验证的时效承诺）。
 */
const TIMELINESS_TERMS: ComplianceTerm[] = [
  { term: '三天见效', category: CATEGORY_TIMELINESS, suggestion: '改为"持续使用效果更佳，请遵循说明书"' },
  { term: '当天灭绝', category: CATEGORY_TIMELINESS, suggestion: '改为"当天可见明显减少"' },
  { term: '立竿见影', category: CATEGORY_TIMELINESS, suggestion: '改为"见效较快"' },
  { term: '瞬间见效', category: CATEGORY_TIMELINESS, suggestion: '改为"见效较快"' },
  { term: '一次见效', category: CATEGORY_TIMELINESS, suggestion: '改为"配合持续使用效果更佳"' },
  { term: '秒杀害虫', category: CATEGORY_TIMELINESS, suggestion: '改为"快速击倒"' },
];

const ALL_TERMS: ComplianceTerm[] = [
  ...ABSOLUTE_TERMS,
  ...PESTICIDE_HIGH_RISK_TERMS,
  ...MEDICAL_EFFICACY_TERMS,
  ...TIMELINESS_TERMS,
];

// ─── 归一化 + 匹配 ──────────────────────────────────────────────────────────

/**
 * 逐字符 1:1 归一化（不改变字符串长度，因此归一化后的下标可以直接当作
 * 原文下标使用）：
 *   - 全角 ASCII（U+FF01-U+FF5E，含全角字母/数字/％等符号）→ 半角
 *   - 全角空格（U+3000）→ 半角空格
 *   - 带圈数字 ①-⑨（U+2460-U+2468）→ 阿拉伯数字 '1'-'9'
 */
function normalizeForMatching(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCharCode(code - 0xfee0);
    } else if (code === 0x3000) {
      out += ' ';
    } else if (code >= 0x2460 && code <= 0x2468) {
      out += String.fromCharCode(code - 0x2460 + 0x31);
    } else {
      out += ch;
    }
  }
  return out;
}

function escapeRegExpChar(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 允许词中间插入至多 2 个常见分隔符（空格/中横线/下划线/点/顿号/逗号/斜杠）
// 来规避——如"最 佳""无-毒-无-害"。插入更多噪音字符（3 个以上）不覆盖，
// 避免正则过度宽松导致误伤正常文案。
const SEPARATOR = '[\\s\\-_·./、，,]{0,2}';

function buildTermPattern(term: string): RegExp {
  const parts = Array.from(term).map(escapeRegExpChar);
  return new RegExp(parts.join(SEPARATOR), 'gi');
}

const TERM_PATTERNS: Map<ComplianceTerm, RegExp> = new Map(
  ALL_TERMS.map((entry) => [entry, buildTermPattern(entry.term)]),
);

/**
 * 检查一段文案是否命中违禁词库。纯本地正则匹配，不调用 AI（见文件头注释）。
 */
export function checkCopy(text: string): ComplianceResult {
  const normalized = normalizeForMatching(text);
  const issues: ComplianceIssue[] = [];

  for (const entry of ALL_TERMS) {
    const pattern = TERM_PATTERNS.get(entry);
    if (!pattern) continue;
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(normalized)) !== null) {
      const matchedLength = match[0].length;
      issues.push({
        term: text.slice(match.index, match.index + matchedLength),
        category: entry.category,
        position: match.index,
        suggestion: entry.suggestion,
      });
      // 空匹配理论上不会出现（词库里没有空字符串词条），这里兜底防死循环。
      if (matchedLength === 0) {
        pattern.lastIndex += 1;
      }
    }
  }

  issues.sort((a, b) => a.position - b.position);

  return {
    passed: issues.length === 0,
    issues,
  };
}
