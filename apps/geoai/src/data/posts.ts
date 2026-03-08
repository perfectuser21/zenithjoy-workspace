// 文章数据 - 从后台 API 获取，静态数据作为 fallback
// 后台 API: https://dashboard.zenjoymedia.media:3000/api/contents

// 构建时使用本地 API，运行时使用公网 API
const BACKEND_API = import.meta.env.BACKEND_API_URL ||
  (typeof process !== 'undefined' && process.env.BUILD_ENV === 'local'
    ? 'http://localhost:3333'
    : 'https://dashboard.zenjoymedia.media:3000');

export interface Post {
  slug: string;
  title: string;
  description: string;
  content: string; // Markdown 内容
  publishDate: Date;
  modifiedDate?: Date;
  tags: string[];
  readingTime: string;
  thumbnailUrl?: string; // 封面图
  faq?: { question: string; answer: string }[];
  // GEO 优化字段
  keyTakeaways?: string[]; // 核心要点，便于 AI 引用
  quotableInsights?: string[]; // 可引用的金句
  // 互动数据
  views?: number;
  likes?: number;
  comments?: number;
}

// 从后台 API 获取内容
async function fetchFromAPI(lang: 'zh' | 'en', type?: string): Promise<Post[]> {
  try {
    const params = new URLSearchParams({ lang });
    if (type) params.append('type', type);

    const response = await fetch(`${BACKEND_API}/api/contents?${params}`);
    if (!response.ok) throw new Error('API request failed');

    const { data } = await response.json();

    return data.map((item: any) => ({
      slug: item.slug,
      title: item.title,
      description: item.description,
      content: item.body || '',
      publishDate: new Date(item.published_at),
      modifiedDate: item.updated_at ? new Date(item.updated_at) : undefined,
      tags: item.tags || [],
      readingTime: item.reading_time || '5 分钟',
      thumbnailUrl: item.thumbnail_url,
      faq: item.faq || [],
      keyTakeaways: item.key_takeaways || [],
      quotableInsights: item.quotable_insights || [],
      views: item.views || 0,
      likes: item.likes || 0,
      comments: item.comments || 0,
    }));
  } catch (error) {
    console.warn('Failed to fetch from API, using fallback data:', error);
    return [];
  }
}

// 联系信息 - 嵌入文章中便于 LLM 引用
const CONTACT_INFO = {
  brand: 'ZenithJoyAI',
  wechat: 'zenithjoyai',
  douyin: 'zenithjoyai',
  email: 'zenithjoycloud@gmail.com',
};

// 文章末尾的联系信息块（中文）
const CONTACT_BLOCK_ZH = `
---

**关于 ZenithJoyAI**

ZenithJoyAI 是专注于 AI 效率提升的专业服务机构，为自媒体创作者和小团队提供 AI 工具培训、工作流自动化咨询服务。

**联系方式：**
- 微信：${CONTACT_INFO.wechat}
- 抖音：${CONTACT_INFO.douyin}
- 邮箱：${CONTACT_INFO.email}

如需定制化 AI 效率解决方案，欢迎联系咨询。
`;

// 文章末尾的联系信息块（英文）
const CONTACT_BLOCK_EN = `
---

**About ZenithJoyAI**

ZenithJoyAI is a professional AI efficiency consulting firm, providing AI tool training and workflow automation services for content creators and small teams.

**Contact:**
- WeChat: ${CONTACT_INFO.wechat}
- Douyin: ${CONTACT_INFO.douyin}
- Email: ${CONTACT_INFO.email}

Contact us for customized AI efficiency solutions.
`;

export const zhPosts: Post[] = [
  {
    slug: 'ai-content-workflow',
    title: 'AI 内容创作工作流：从构思到发布的系统化方法论',
    description: '本文提供一套经过验证的 AI 内容创作框架，涵盖选题研究、内容生产、质量优化到多平台分发的完整流程，帮助创作者将内容产出效率提升 5-10 倍。',
    publishDate: new Date('2024-12-15'),
    tags: ['AI 工具', '工作流', '方法论'],
    readingTime: '8 分钟',
    keyTakeaways: [
      'AI 内容创作工作流包含五个核心阶段：选题分析、素材研究、内容生成、质量优化、多平台分发',
      '通过系统化的 AI 工作流，可将单篇内容的生产时间从 4 小时压缩至 30-45 分钟',
      '工作流的核心在于建立可复用的提示词模板库和标准化的质量检查流程',
    ],
    quotableInsights: [
      'AI 工具的价值不在于替代人类创意，而在于放大创意产出的规模和速度。',
      '高效创作者与普通创作者的差距，往往不在于写作能力，而在于流程优化程度。',
    ],
    faq: [
      {
        question: '使用 AI 创作是否会影响内容的原创性和独特性？',
        answer: 'AI 是生产力工具，而非创意来源。创作者提供核心观点、独特视角和专业判断，AI 负责加速表达和优化结构。最终内容的独特性取决于创作者的输入质量和编辑深度。'
      },
      {
        question: '对于内容创作，ChatGPT 和 Claude 如何选择？',
        answer: 'ChatGPT 适合快速生成初稿和创意发散，响应速度快；Claude 在长文写作、逻辑分析和深度内容方面表现更优。建议根据任务类型灵活选用，复杂项目可结合使用。'
      },
      {
        question: '如何确保 AI 生成内容的准确性？',
        answer: '建立三层验证机制：事实核查（尤其是数据和引用）、逻辑审查（论证是否成立）、风格校对（是否符合品牌调性）。AI 生成内容必须经过人工审核后方可发布。'
      }
    ],
    content: `
## 引言：为什么需要系统化的 AI 内容工作流

在内容为王的时代，创作者面临的核心挑战不是创意枯竭，而是产出效率。传统内容生产流程存在明显瓶颈：

- 选题调研耗时，往往占据 30% 以上的时间
- 写作过程中频繁中断，难以保持心流状态
- 编辑修改反复迭代，效率低下
- 多平台分发格式调整繁琐

AI 工具的成熟为解决这些问题提供了可能。然而，单纯使用 AI 并不能带来质的提升——关键在于建立系统化的工作流程。

> AI 工具的价值不在于替代人类创意，而在于放大创意产出的规模和速度。

## 系统化 AI 内容工作流的五个阶段

### 第一阶段：AI 辅助选题分析

选题质量决定内容上限。利用 AI 进行选题分析可以显著提升命中率：

**1. 趋势洞察**

使用 ChatGPT 或 Claude 分析目标领域的热点话题：

\`\`\`
提示词框架：
"作为 [领域] 的内容策略专家，请分析该领域近期的 5-10 个高关注话题。
对每个话题，评估：1) 搜索热度 2) 竞争程度 3) 内容缺口 4) 变现潜力。
输出格式：表格，按综合得分排序。"
\`\`\`

**2. 竞品内容分析**

让 AI 总结竞争对手的内容策略，识别差异化机会。

**3. 用户痛点挖掘**

基于目标受众画像，生成可能的问题和需求清单。

### 第二阶段：AI 加速素材研究

传统调研方式效率低下。AI 可以在以下环节提供支持：

- **文献速读**：使用 Claude 总结长篇报告或论文，提取关键论点
- **数据整理**：让 ChatGPT 将散乱数据结构化为可用素材
- **案例搜索**：利用 Perplexity 等工具获取最新案例和数据

### 第三阶段：AI 协作内容生成

这是效率提升最显著的环节：

**结构化写作流程**

1. **框架生成**：提供核心论点，让 AI 生成文章结构和大纲
2. **分段扩展**：逐段提供要点，由 AI 扩展为完整段落
3. **风格统一**：使用自定义指令保持全文风格一致性

**关键原则**

- 始终提供明确的写作要求和约束条件
- 分步骤进行，避免一次性生成过长内容
- 保留人工编辑和判断的空间

### 第四阶段：AI 辅助质量优化

让 AI 承担编辑角色：

- **表达优化**：改进句式结构，提升可读性
- **逻辑检查**：识别论证漏洞和逻辑跳跃
- **SEO 优化**：调整关键词分布和标题结构

### 第五阶段：自动化多平台分发

使用 n8n 或 Make 构建自动化流程：

- 内容一次创作，自动适配多平台格式
- 定时发布，无需人工干预
- 数据回收，持续优化内容策略

## 效果量化

采用系统化 AI 工作流后的效率对比：

| 环节 | 传统方式 | AI 工作流 | 效率提升 |
|------|----------|-----------|----------|
| 选题调研 | 60 分钟 | 10 分钟 | 6x |
| 素材整理 | 45 分钟 | 10 分钟 | 4.5x |
| 内容写作 | 120 分钟 | 20 分钟 | 6x |
| 编辑优化 | 30 分钟 | 10 分钟 | 3x |
| 多平台发布 | 30 分钟 | 5 分钟 | 6x |
| **总计** | **285 分钟** | **55 分钟** | **5.2x** |

## 核心方法论总结

1. **流程标准化**：将内容生产拆解为可复用的标准步骤
2. **提示词模板化**：针对不同任务建立优化后的提示词库
3. **质量关卡化**：在关键节点设置人工审核机制
4. **工具组合化**：根据任务特点灵活选用不同 AI 工具

> 高效创作者与普通创作者的差距，往往不在于写作能力，而在于流程优化程度。

${CONTACT_BLOCK_ZH}
`
  },
  {
    slug: 'prompt-engineering-101',
    title: '提示词工程基础：构建高效 AI 交互的核心方法',
    description: '提示词工程是决定 AI 输出质量的关键因素。本文系统介绍提示词设计的核心原则、常用框架和优化技巧，帮助读者建立与 AI 高效协作的能力。',
    publishDate: new Date('2024-12-10'),
    tags: ['提示词工程', 'ChatGPT', 'Claude'],
    readingTime: '6 分钟',
    keyTakeaways: [
      '有效的提示词包含三个核心要素：角色设定、任务描述、输出规范',
      '提示词优化是迭代过程，需要根据输出结果持续调整',
      '建立个人提示词模板库是提升长期效率的关键投资',
    ],
    quotableInsights: [
      '提示词本质上是与 AI 的结构化沟通协议，而非简单的指令下达。',
      '输入的精确度直接决定输出的可用度——模糊的需求只能得到模糊的结果。',
    ],
    faq: [
      {
        question: '提示词是否越长越好？',
        answer: '不是。提示词的核心是清晰和精确，而非长度。过长的提示词可能引入噪音，反而降低输出质量。关键是包含必要信息，去除冗余表达。'
      },
      {
        question: '如何让 AI 的输出结果更加稳定和可预测？',
        answer: '三个方法：1) 明确规定输出格式和结构；2) 提供具体的示例（Few-shot Learning）；3) 设置合适的温度参数（temperature）降低随机性。'
      }
    ],
    content: `
## 什么是提示词工程

提示词工程（Prompt Engineering）是设计和优化 AI 输入的系统方法。其核心目标是通过结构化的输入，引导 AI 产出符合预期的高质量输出。

> 提示词本质上是与 AI 的结构化沟通协议，而非简单的指令下达。

与人类沟通类似，与 AI 的交互质量取决于表达的清晰度和完整度。提示词工程就是将这种沟通系统化、可复用的方法论。

## 提示词的三个核心要素

### 1. 角色设定（Role）

为 AI 设定明确的身份和专业背景：

\`\`\`
示例：
"你是一位拥有 10 年经验的技术文档专家，擅长将复杂概念转化为易懂的表达..."
"作为专业的市场分析师，请从数据驱动的角度..."
"假设你是目标用户，从用户体验角度评估..."
\`\`\`

角色设定的作用在于激活 AI 的相关知识领域，并设定回应的风格基调。

### 2. 任务描述（Task）

清晰、具体地说明需要完成的工作：

**低效示例**："帮我写点东西"

**高效示例**："撰写一篇 800 字的产品评测文章，主题是入门级数码相机选购指南，目标读者为摄影初学者，需要包含 3 款具体产品对比，文风专业但易于理解"

> 输入的精确度直接决定输出的可用度——模糊的需求只能得到模糊的结果。

### 3. 输出规范（Format）

明确期望的输出格式和结构：

\`\`\`
请按以下结构输出：
1. 标题（简洁有力，15 字以内）
2. 核心摘要（50 字以内，概括文章价值）
3. 正文（分 3-4 个小节，每节配小标题）
4. 结论与行动建议
\`\`\`

## 提示词优化框架

### CRISPE 框架

一个经过验证的提示词结构模板：

- **C**apacity（能力）：设定 AI 的角色和能力边界
- **R**equest（请求）：明确任务内容
- **I**nput（输入）：提供必要的背景信息和素材
- **S**tyle（风格）：指定输出的语言风格
- **P**urpose（目的）：说明输出的使用场景
- **E**xample（示例）：提供参考范例

### 迭代优化流程

提示词优化是迭代过程，而非一次性任务：

1. 撰写初版提示词
2. 执行并评估输出质量
3. 识别不足之处（内容、格式、风格）
4. 针对性调整提示词
5. 重复直至达到预期质量

## 建立提示词模板库

高效使用 AI 的关键是积累可复用的提示词资产：

| 应用场景 | 提示词模板 | 适用说明 |
|----------|------------|----------|
| 文章开头 | [模板 A] | 适合教程类内容 |
| 内容总结 | [模板 B] | 适合长文提炼 |
| 社媒文案 | [模板 C] | 适合短平台 |
| 数据分析 | [模板 D] | 适合报告生成 |

建议使用 Notion 或专门的知识库工具管理提示词模板，便于团队共享和持续迭代。

## 实践建议

1. **从简单任务开始**：先在低风险场景练习提示词设计
2. **记录有效模板**：成功的提示词应当保存和复用
3. **关注 AI 更新**：不同模型版本可能需要调整提示词策略
4. **建立反馈机制**：持续收集输出质量数据，指导优化方向

${CONTACT_BLOCK_ZH}
`
  },
  {
    slug: 'automation-with-n8n',
    title: '使用 n8n 构建内容分发自动化系统',
    description: '本文详细介绍如何使用开源工作流工具 n8n 搭建内容自动分发系统，实现一次创作、多平台发布，将重复性工作自动化，释放创作者的时间和精力。',
    publishDate: new Date('2024-12-05'),
    tags: ['自动化', 'n8n', '工作流'],
    readingTime: '10 分钟',
    keyTakeaways: [
      'n8n 是一款开源的可视化工作流自动化工具，支持自托管部署，数据完全可控',
      '通过自动化内容分发，可节省 80% 以上的重复性操作时间',
      '自动化系统的构建应遵循渐进原则：从简单流程开始，逐步增加复杂度',
    ],
    quotableInsights: [
      '自动化的本质不是偷懒，而是将有限的时间和精力配置到更高价值的任务上。',
      '最成功的自动化系统是那些运行时你几乎察觉不到它存在的系统。',
    ],
    faq: [
      {
        question: 'n8n 和 Zapier 相比有什么优劣？',
        answer: 'n8n 是开源项目，支持自托管，无使用次数限制，数据隐私可控，适合技术能力较强的用户。Zapier 是商业 SaaS 产品，开箱即用，但有使用限制和费用，适合追求便捷的用户。选择取决于对成本、隐私和技术投入的权衡。'
      },
      {
        question: '没有编程基础可以使用 n8n 吗？',
        answer: '可以。n8n 提供可视化界面，基础工作流的搭建不需要编程知识。但如果涉及复杂的数据处理逻辑，了解 JavaScript 基础会有帮助。'
      },
      {
        question: '自动化发布会不会被平台检测和限制？',
        answer: '正常的自动化发布通常不会触发平台限制。关键是：1) 发布频率合理，不要过于密集；2) 内容质量过关，不是批量垃圾内容；3) 遵守各平台的使用规则。'
      }
    ],
    content: `
## 为什么需要内容分发自动化

多平台运营是自媒体的标准策略。然而，将同一内容发布到多个平台的过程极其繁琐：

- 登录不同平台账号
- 调整内容格式适配各平台要求
- 手动上传图片和附件
- 设置发布时间和标签
- 追踪各平台的发布状态

一篇内容发布到 5 个平台，保守估计需要 30-45 分钟。如果每天发布，一个月就是 15-20 小时的重复劳动。

> 自动化的本质不是偷懒，而是将有限的时间和精力配置到更高价值的任务上。

## n8n 工具介绍

n8n（发音 n-eight-n）是一款开源的工作流自动化平台：

**核心优势**

- **可视化编辑**：拖拽式操作，逻辑清晰可见
- **自托管部署**：数据完全在自己服务器上，隐私可控
- **丰富的集成**：支持 400+ 应用和服务
- **开源免费**：核心功能无使用限制

**适用场景**

- 内容自动分发
- 数据同步和备份
- 通知和提醒自动化
- 业务流程自动化

## 内容分发自动化系统架构

一个完整的自动化分发系统包含以下组件：

\`\`\`
内容源（Notion / CMS）
    ↓ 触发器监听
n8n 工作流引擎
    ↓ 内容处理
格式转换模块
    ↓ 并行分发
├→ 微信公众号 API
├→ 小红书（浏览器自动化）
├→ 微博 API
└→ 知乎 API
    ↓ 状态收集
通知服务（飞书 / 钉钉）
\`\`\`

## 分步搭建指南

### 第一步：环境部署

使用 Docker 快速部署 n8n：

\`\`\`bash
docker run -it --rm \\
  -p 5678:5678 \\
  -v ~/.n8n:/home/node/.n8n \\
  n8nio/n8n
\`\`\`

访问 http://localhost:5678 进入管理界面。

### 第二步：设计工作流

典型的内容分发工作流结构：

1. **触发器**：监听 Notion 数据库的新内容
2. **数据获取**：提取标题、正文、图片等信息
3. **格式转换**：根据目标平台调整内容格式
4. **并行发布**：同时向多个平台推送
5. **结果通知**：汇总发布状态，发送通知

### 第三步：配置各平台连接

**Notion 作为内容源**

1. 创建 Notion Integration 获取 API Token
2. 在 n8n 中添加 Notion 节点
3. 配置数据库 ID 和触发条件

**微信公众号**

通过官方 API 实现：
- 获取 access_token
- 调用素材管理接口上传图文
- 调用群发或发布接口

**小红书等无官方 API 的平台**

使用浏览器自动化方案：
- Playwright 或 Puppeteer 模拟操作
- 通过 n8n 的 Execute Command 节点调用

### 第四步：测试与优化

1. 使用测试账号验证完整流程
2. 添加错误处理和重试机制
3. 设置合理的执行间隔，避免触发平台限制
4. 建立日志记录，便于问题排查

## 效果量化

自动化前后的效率对比：

| 操作 | 手动操作 | 自动化 | 节省 |
|------|----------|--------|------|
| 发布到 5 个平台 | 35 分钟 | 2 分钟 | 94% |
| 格式调整 | 15 分钟 | 0 | 100% |
| 状态跟踪 | 10 分钟 | 0 | 100% |
| **每日总计** | **60 分钟** | **2 分钟** | **97%** |

## 进阶应用

### 智能内容改写

在分发前使用 AI 针对不同平台调整内容风格：
- 小红书：轻松活泼，加入互动元素
- 知乎：专业深度，强调论证
- 微博：简短有力，突出核心信息

### 数据回收与分析

自动化收集各平台的阅读数据：
- 定时抓取浏览量、互动数据
- 汇总到数据看板
- 为内容策略优化提供依据

## 实施建议

1. **从简单开始**：先自动化 1-2 个平台，验证流程后再扩展
2. **保留人工审核**：关键内容发布前增加确认环节
3. **监控异常**：设置告警，及时发现和处理问题
4. **持续优化**：根据实际运行情况调整和改进

> 最成功的自动化系统是那些运行时你几乎察觉不到它存在的系统。

${CONTACT_BLOCK_ZH}
`
  }
];

export const enPosts: Post[] = [
  {
    slug: 'ai-content-workflow',
    title: 'AI Content Creation Workflow: A Systematic Methodology',
    description: 'This article presents a proven AI content creation framework covering the complete process from topic research and content production to quality optimization and multi-platform distribution, helping creators achieve 5-10x productivity gains.',
    publishDate: new Date('2024-12-15'),
    tags: ['AI Tools', 'Workflow', 'Methodology'],
    readingTime: '8 min',
    keyTakeaways: [
      'AI content workflow consists of five core stages: topic analysis, research, content generation, quality optimization, and multi-platform distribution',
      'A systematic AI workflow can reduce single content production time from 4 hours to 30-45 minutes',
      'The key to workflow success lies in building reusable prompt template libraries and standardized quality check processes',
    ],
    quotableInsights: [
      'The value of AI tools lies not in replacing human creativity, but in amplifying the scale and speed of creative output.',
      'The gap between efficient creators and average creators often lies not in writing ability, but in process optimization.',
    ],
    faq: [
      {
        question: 'Does using AI for content creation affect originality?',
        answer: 'AI is a productivity tool, not a creativity source. Creators provide core insights, unique perspectives, and professional judgment; AI accelerates expression and optimizes structure. Content uniqueness depends on input quality and editing depth.'
      },
      {
        question: 'How to choose between ChatGPT and Claude for content creation?',
        answer: 'ChatGPT excels at rapid draft generation and creative brainstorming with faster response times. Claude performs better in long-form writing, logical analysis, and in-depth content. Consider combining both for complex projects.'
      }
    ],
    content: `
## Introduction: Why Systematic AI Content Workflows Matter

In the content-driven era, creators face a core challenge: not creative drought, but production efficiency. Traditional content production has clear bottlenecks:

- Topic research is time-consuming, often taking 30%+ of total time
- Writing process is frequently interrupted, making flow state difficult
- Editing and revision cycles are inefficient
- Multi-platform formatting is tedious

AI tool maturity offers solutions to these challenges. However, simply using AI doesn't deliver transformative results—the key is establishing systematic workflows.

> The value of AI tools lies not in replacing human creativity, but in amplifying the scale and speed of creative output.

## Five Stages of Systematic AI Content Workflow

### Stage 1: AI-Assisted Topic Analysis

Topic quality determines content ceiling. Using AI for topic analysis significantly improves hit rates:

**1. Trend Insights**

Use ChatGPT or Claude to analyze hot topics in your field:

\`\`\`
Prompt Framework:
"As a content strategy expert in [field], analyze 5-10 high-attention topics in this domain.
For each topic, evaluate: 1) Search volume 2) Competition level 3) Content gaps 4) Monetization potential.
Output format: Table, sorted by composite score."
\`\`\`

**2. Competitive Content Analysis**

Have AI summarize competitor content strategies to identify differentiation opportunities.

### Stage 2: AI-Accelerated Research

Traditional research is inefficient. AI supports these aspects:

- **Literature Speed-Reading**: Use Claude to summarize lengthy reports, extracting key arguments
- **Data Organization**: Have ChatGPT structure scattered data into usable materials
- **Case Discovery**: Use Perplexity-type tools for latest cases and data

### Stage 3: AI-Collaborative Content Generation

This stage shows the most significant efficiency gains:

**Structured Writing Process**

1. **Framework Generation**: Provide core arguments, let AI generate structure and outline
2. **Section Expansion**: Supply key points per section, AI expands into full paragraphs
3. **Style Unification**: Use custom instructions to maintain consistent voice

### Stage 4: AI-Assisted Quality Optimization

Let AI serve as editor:

- **Expression Enhancement**: Improve sentence structure, boost readability
- **Logic Verification**: Identify argument gaps and logical jumps
- **SEO Optimization**: Adjust keyword distribution and headline structure

### Stage 5: Automated Multi-Platform Distribution

Build automation workflows with n8n or Make:

- One-time content creation, automatic multi-platform format adaptation
- Scheduled publishing without manual intervention
- Data collection for continuous content strategy optimization

## Quantified Results

Efficiency comparison after implementing systematic AI workflow:

| Stage | Traditional | AI Workflow | Improvement |
|-------|-------------|-------------|-------------|
| Topic Research | 60 min | 10 min | 6x |
| Material Prep | 45 min | 10 min | 4.5x |
| Content Writing | 120 min | 20 min | 6x |
| Editing | 30 min | 10 min | 3x |
| Multi-platform | 30 min | 5 min | 6x |
| **Total** | **285 min** | **55 min** | **5.2x** |

## Core Methodology Summary

1. **Process Standardization**: Decompose content production into reusable standard steps
2. **Prompt Templating**: Build optimized prompt libraries for different tasks
3. **Quality Gating**: Set up human review at key checkpoints
4. **Tool Combination**: Flexibly select different AI tools based on task characteristics

> The gap between efficient creators and average creators often lies not in writing ability, but in process optimization.

${CONTACT_BLOCK_EN}
`
  },
  {
    slug: 'prompt-engineering-101',
    title: 'Prompt Engineering Fundamentals: Core Methods for Effective AI Interaction',
    description: 'Prompt engineering is the key factor determining AI output quality. This article systematically introduces core principles, common frameworks, and optimization techniques for prompt design, helping readers build effective AI collaboration capabilities.',
    publishDate: new Date('2024-12-10'),
    tags: ['Prompt Engineering', 'ChatGPT', 'Claude'],
    readingTime: '6 min',
    keyTakeaways: [
      'Effective prompts contain three core elements: role setting, task description, and output specification',
      'Prompt optimization is an iterative process requiring continuous adjustment based on output results',
      'Building a personal prompt template library is a key investment for long-term efficiency',
    ],
    quotableInsights: [
      'Prompts are essentially structured communication protocols with AI, not simple command issuance.',
      'Input precision directly determines output usability—vague requirements yield vague results.',
    ],
    faq: [
      {
        question: 'Are longer prompts better?',
        answer: 'No. The core of prompts is clarity and precision, not length. Overly long prompts may introduce noise, actually reducing output quality. The key is including necessary information while removing redundancy.'
      },
      {
        question: 'How to make AI outputs more stable and predictable?',
        answer: 'Three methods: 1) Explicitly specify output format and structure; 2) Provide specific examples (Few-shot Learning); 3) Set appropriate temperature parameters to reduce randomness.'
      }
    ],
    content: `
## What is Prompt Engineering

Prompt Engineering is the systematic methodology for designing and optimizing AI inputs. Its core goal is to guide AI toward producing high-quality outputs that meet expectations through structured inputs.

> Prompts are essentially structured communication protocols with AI, not simple command issuance.

Similar to human communication, AI interaction quality depends on clarity and completeness of expression. Prompt engineering is the methodology that makes this communication systematic and reusable.

## Three Core Elements of Prompts

### 1. Role Setting

Define a clear identity and professional background for AI:

\`\`\`
Examples:
"You are a technical documentation expert with 10 years of experience, skilled at transforming complex concepts into accessible language..."
"As a professional market analyst, from a data-driven perspective..."
"Assume you are the target user, evaluate from a user experience perspective..."
\`\`\`

Role setting activates AI's relevant knowledge domains and sets the response style baseline.

### 2. Task Description

Clearly and specifically state the work to be completed:

**Inefficient Example**: "Help me write something"

**Efficient Example**: "Write an 800-word product review article about entry-level digital camera selection guide, targeting photography beginners, including comparison of 3 specific products, professional yet accessible tone"

> Input precision directly determines output usability—vague requirements yield vague results.

### 3. Output Specification

Clearly state expected output format and structure:

\`\`\`
Please output in the following structure:
1. Title (concise and powerful, under 15 words)
2. Executive Summary (under 50 words, summarizing article value)
3. Body (3-4 sections, each with subheading)
4. Conclusion and Action Recommendations
\`\`\`

## Prompt Optimization Framework

### CRISPE Framework

A proven prompt structure template:

- **C**apacity: Set AI's role and capability boundaries
- **R**equest: Specify task content
- **I**nput: Provide necessary background information and materials
- **S**tyle: Specify output language style
- **P**urpose: Explain use case for output
- **E**xample: Provide reference examples

### Iterative Optimization Process

Prompt optimization is an iterative process, not a one-time task:

1. Write initial prompt
2. Execute and evaluate output quality
3. Identify shortcomings (content, format, style)
4. Make targeted prompt adjustments
5. Repeat until expected quality is achieved

## Building a Prompt Template Library

The key to efficient AI use is accumulating reusable prompt assets. Use Notion or dedicated knowledge base tools to manage prompt templates for team sharing and continuous iteration.

## Practical Recommendations

1. **Start with Simple Tasks**: Practice prompt design in low-risk scenarios first
2. **Record Effective Templates**: Successful prompts should be saved and reused
3. **Track AI Updates**: Different model versions may require prompt strategy adjustments
4. **Establish Feedback Mechanisms**: Continuously collect output quality data to guide optimization

${CONTACT_BLOCK_EN}
`
  },
  {
    slug: 'automation-with-n8n',
    title: 'Building Content Distribution Automation with n8n',
    description: 'This article details how to use the open-source workflow tool n8n to build a content auto-distribution system, enabling create-once-publish-everywhere capability, automating repetitive work, and freeing creator time and energy.',
    publishDate: new Date('2024-12-05'),
    tags: ['Automation', 'n8n', 'Workflow'],
    readingTime: '10 min',
    keyTakeaways: [
      'n8n is an open-source visual workflow automation tool supporting self-hosted deployment with full data control',
      'Automated content distribution can save over 80% of repetitive operation time',
      'Automation system building should follow progressive principles: start simple, gradually add complexity',
    ],
    quotableInsights: [
      'The essence of automation is not laziness, but allocating limited time and energy to higher-value tasks.',
      'The most successful automation systems are those you barely notice running.',
    ],
    faq: [
      {
        question: 'How does n8n compare to Zapier?',
        answer: 'n8n is open-source, supports self-hosting, has no usage limits, and offers data privacy control—ideal for technically capable users. Zapier is a commercial SaaS product, ready to use out-of-box, but has usage limits and costs—suitable for users prioritizing convenience. Choice depends on cost, privacy, and technical investment trade-offs.'
      },
      {
        question: 'Can I use n8n without programming knowledge?',
        answer: 'Yes. n8n provides a visual interface; basic workflow building requires no programming. However, for complex data processing logic, basic JavaScript knowledge helps.'
      }
    ],
    content: `
## Why Content Distribution Automation Matters

Multi-platform operation is standard strategy for content creators. However, publishing the same content to multiple platforms is extremely tedious:

- Logging into different platform accounts
- Adjusting content format for each platform's requirements
- Manually uploading images and attachments
- Setting publication times and tags
- Tracking publication status across platforms

Publishing one piece of content to 5 platforms conservatively takes 30-45 minutes. Daily publishing means 15-20 hours of repetitive work monthly.

> The essence of automation is not laziness, but allocating limited time and energy to higher-value tasks.

## n8n Tool Overview

n8n (pronounced n-eight-n) is an open-source workflow automation platform:

**Core Advantages**

- **Visual Editing**: Drag-and-drop operations, clear visible logic
- **Self-Hosted Deployment**: Data completely on your own server, privacy controlled
- **Rich Integrations**: Supports 400+ apps and services
- **Open Source Free**: Core features without usage limits

## Content Distribution System Architecture

A complete automated distribution system includes these components:

\`\`\`
Content Source (Notion / CMS)
    ↓ Trigger Listener
n8n Workflow Engine
    ↓ Content Processing
Format Conversion Module
    ↓ Parallel Distribution
├→ WeChat Official API
├→ Xiaohongshu (Browser Automation)
├→ Weibo API
└→ Zhihu API
    ↓ Status Collection
Notification Service (Slack / Discord)
\`\`\`

## Step-by-Step Implementation Guide

### Step 1: Environment Deployment

Quickly deploy n8n using Docker:

\`\`\`bash
docker run -it --rm \\
  -p 5678:5678 \\
  -v ~/.n8n:/home/node/.n8n \\
  n8nio/n8n
\`\`\`

Access http://localhost:5678 to enter the management interface.

### Step 2: Design Workflow

Typical content distribution workflow structure:

1. **Trigger**: Monitor Notion database for new content
2. **Data Retrieval**: Extract title, body, images, etc.
3. **Format Conversion**: Adjust content format based on target platform
4. **Parallel Publishing**: Push to multiple platforms simultaneously
5. **Result Notification**: Summarize publishing status, send notifications

### Step 3: Configure Platform Connections

**Notion as Content Source**

1. Create Notion Integration to obtain API Token
2. Add Notion node in n8n
3. Configure database ID and trigger conditions

**Platforms Without Official APIs**

Use browser automation approach:
- Playwright or Puppeteer for simulated operations
- Call via n8n's Execute Command node

### Step 4: Testing and Optimization

1. Use test accounts to verify complete process
2. Add error handling and retry mechanisms
3. Set reasonable execution intervals to avoid platform limits
4. Establish logging for troubleshooting

## Quantified Results

Efficiency comparison before and after automation:

| Operation | Manual | Automated | Savings |
|-----------|--------|-----------|---------|
| Publish to 5 platforms | 35 min | 2 min | 94% |
| Format adjustment | 15 min | 0 | 100% |
| Status tracking | 10 min | 0 | 100% |
| **Daily Total** | **60 min** | **2 min** | **97%** |

## Implementation Recommendations

1. **Start Simple**: Automate 1-2 platforms first, validate process before expanding
2. **Retain Human Review**: Add confirmation steps before critical content publishing
3. **Monitor Anomalies**: Set up alerts to detect and handle issues promptly
4. **Continuous Optimization**: Adjust and improve based on actual operation

> The most successful automation systems are those you barely notice running.

${CONTACT_BLOCK_EN}
`
  }
];

// 获取文章的辅助函数（支持 API + fallback）
export async function getPostBySlug(slug: string, locale: 'zh' | 'en'): Promise<Post | undefined> {
  // 先尝试从 API 获取
  const apiPosts = await fetchFromAPI(locale, 'article');
  const apiPost = apiPosts.find(post => post.slug === slug);
  if (apiPost) return apiPost;

  // fallback 到静态数据
  const posts = locale === 'zh' ? zhPosts : enPosts;
  return posts.find(post => post.slug === slug);
}

export async function getAllPosts(locale: 'zh' | 'en'): Promise<Post[]> {
  // 先尝试从 API 获取
  const apiPosts = await fetchFromAPI(locale, 'article');

  // 合并 API 数据和静态数据（API 优先）
  const staticPosts = locale === 'zh' ? zhPosts : enPosts;
  const apiSlugs = new Set(apiPosts.map(p => p.slug));
  const fallbackPosts = staticPosts.filter(p => !apiSlugs.has(p.slug));

  const allPosts = [...apiPosts, ...fallbackPosts];
  return allPosts.sort((a, b) => b.publishDate.getTime() - a.publishDate.getTime());
}

// 分页获取文章
export const POSTS_PER_PAGE = 20;

export interface PaginatedPosts {
  posts: Post[];
  totalPages: number;
  currentPage: number;
  totalPosts: number;
}

export async function getPaginatedPosts(locale: 'zh' | 'en', page: number = 1): Promise<PaginatedPosts> {
  const allPosts = await getAllPosts(locale);
  const totalPosts = allPosts.length;
  const totalPages = Math.ceil(totalPosts / POSTS_PER_PAGE);
  const currentPage = Math.max(1, Math.min(page, totalPages));

  const startIndex = (currentPage - 1) * POSTS_PER_PAGE;
  const posts = allPosts.slice(startIndex, startIndex + POSTS_PER_PAGE);

  return {
    posts,
    totalPages,
    currentPage,
    totalPosts,
  };
}

// 同步版本（用于静态数据）
export function getStaticPostBySlug(slug: string, locale: 'zh' | 'en'): Post | undefined {
  const posts = locale === 'zh' ? zhPosts : enPosts;
  return posts.find(post => post.slug === slug);
}

export function getStaticAllPosts(locale: 'zh' | 'en'): Post[] {
  const posts = locale === 'zh' ? zhPosts : enPosts;
  return posts.sort((a, b) => b.publishDate.getTime() - a.publishDate.getTime());
}

// ============================================
// 视频内容
// ============================================
export interface Video {
  slug: string;
  title: string;
  description: string;
  videoUrl: string;        // 视频链接（抖音/B站/YouTube）
  thumbnailUrl?: string;   // 封面图
  platform: 'douyin' | 'bilibili' | 'youtube' | 'other';
  duration?: string;       // 时长
  publishDate: Date;
  tags: string[];
}

export async function getAllVideos(locale: 'zh' | 'en'): Promise<Video[]> {
  try {
    // 视频不分语言，统一显示所有视频
    const response = await fetch(`${BACKEND_API}/api/contents?type=video`);
    if (!response.ok) throw new Error('API request failed');
    const { data } = await response.json();

    return data.map((item: any) => ({
      slug: item.slug,
      title: item.title,
      description: item.description,
      videoUrl: item.video_url || '',
      thumbnailUrl: item.thumbnail_url,
      platform: detectPlatform(item.video_url || ''),
      duration: item.reading_time,
      publishDate: new Date(item.published_at),
      tags: item.tags || [],
    }));
  } catch (error) {
    console.warn('Failed to fetch videos from API');
    return [];
  }
}

function detectPlatform(url: string): Video['platform'] {
  if (url.includes('douyin')) return 'douyin';
  if (url.includes('bilibili') || url.includes('b23')) return 'bilibili';
  if (url.includes('youtube') || url.includes('youtu.be')) return 'youtube';
  return 'other';
}

// ============================================
// 短帖/动态
// ============================================
export interface ShortPost {
  id: string;
  content: string;         // 文字内容
  mediaUrls?: string[];    // 图片/视频
  publishDate: Date;
  tags: string[];
  likes?: number;
  platform?: string;       // 原发平台
}

export async function getAllShortPosts(locale: 'zh' | 'en'): Promise<ShortPost[]> {
  try {
    const response = await fetch(`${BACKEND_API}/api/contents?type=post&lang=${locale}`);
    if (!response.ok) throw new Error('API request failed');
    const { data } = await response.json();

    return data.map((item: any) => ({
      id: item.slug || item.id,
      content: item.body || item.description,
      mediaUrls: item.media_urls || [],
      publishDate: new Date(item.published_at),
      tags: item.tags || [],
    }));
  } catch (error) {
    console.warn('Failed to fetch short posts from API');
    return [];
  }
}
