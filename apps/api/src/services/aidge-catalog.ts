import * as AidgeModels from "@alicloud/aidge20260428";

type Category =
  | "翻译"
  | "图片处理"
  | "视频生成"
  | "商品经营"
  | "虚拟试穿"
  | "零售巡检"
  | "知识库";
type Entry = readonly [id: string, label: string];

// Explicitly reviewed against @alicloud/aidge20260428 5.11.0. New SDK methods
// never become public automatically; the website and server share this catalog.
const groups: ReadonlyArray<readonly [Category, ReadonlyArray<Entry>]> = [
  [
    "翻译",
    [
      ["textTranslate", "文本翻译"],
      ["textTranslateAsync", "文本翻译（异步）"],
      ["prepaidTextTranslate", "文本翻译（包年包月）"],
      ["documentTranslate", "文档翻译"],
      ["imageTranslationStandard", "图片翻译标准版"],
      ["imageTranslationStandardAsync", "图片翻译标准版（异步）"],
      ["imageTranslationPro", "图片翻译 Pro"],
      ["imageTranslationProAsync", "图片翻译 Pro（异步）"],
      ["imageTranslationPlus", "图片翻译 Plus"],
      ["imageTranslationPlusAsync", "图片翻译 Plus（异步）"],
      ["videoTranslation", "视频翻译"],
      ["languageDetect", "语种识别"],
      ["textCorrect", "文本纠错"],
      ["queryAsyncTaskResult", "查询异步任务结果"],
    ],
  ],
  [
    "图片处理",
    [
      ["imageMatting", "智能抠图"],
      ["imageMattingAsync", "智能抠图（异步）"],
      ["imageRemove", "智能消除"],
      ["imageRemoveAsync", "智能消除（异步）"],
      ["imageRemovalPro", "智能消除 Pro"],
      ["imageRemovalProAsync", "智能消除 Pro（异步）"],
      ["imageCropping", "智能裁剪"],
      ["imageRecognition", "智能元素识别"],
      ["imageRecognitionAsync", "智能元素识别（异步）"],
      ["visionFlow", "图片组合处理"],
    ],
  ],
  [
    "视频生成",
    [
      ["videoGeneration", "商品视频生成"],
      ["ecomVideoRecreation", "电商视频裂变"],
    ],
  ],
  [
    "商品经营",
    [
      ["assetOptimizeLite", "商品素材优化 Lite"],
      ["assetOptimizePro", "商品素材优化 Pro"],
      ["generateProductContent", "商品文案生成"],
      ["categoryMatch", "商品类目匹配"],
      ["categoryAttributeMatch", "商品属性匹配"],
      ["sizeChartDetect", "尺码图检测"],
      ["sizeChartExtract", "尺码图提取"],
      ["sizeChartExtractAsync", "尺码图提取（异步）"],
      ["productHotspotDetection", "商品热区识别"],
      ["submitProductMatch", "同款素材生成"],
      ["packageWeightSizeCheck", "件重尺审核"],
    ],
  ],
  [
    "虚拟试穿",
    [
      ["aiTryOn", "AI 虚拟试穿"],
      ["virtualTryOn", "虚拟试穿"],
    ],
  ],
  [
    "零售巡检",
    [
      ["materialInspection", "物料陈列检测"],
      ["merchandisePlacementDetection", "商品陈列检测"],
      ["merchandisePlacementDetectionLite", "商品陈列检测 Lite"],
      ["merchandisePlacementDetectionPro", "商品陈列检测 Pro"],
      ["merchandisePriceTagDetection", "陈列价签检测"],
      ["merchandiseSceneDetection", "陈列场景检测"],
      ["storefrontSceneRecognition", "店头场景识别"],
      ["diduiAreaDeduction", "地堆面积推理"],
      ["diduiAreaDeductionPro", "地堆面积推理 Pro"],
      ["generalRephotographyDetection", "通用翻拍检测"],
      ["milkPowderCanBottomCodeRephotographyDetection", "奶粉罐底码翻拍检测"],
      ["milkPowderCartonCodeRephotographyDetection", "奶粉箱码翻拍检测"],
      ["petHealthAnalysis", "宠物健康图文分析"],
    ],
  ],
  [
    "知识库",
    [
      ["addDisplayKnowledge", "新增陈列知识"],
      ["updateDisplayKnowledge", "更新陈列知识"],
      ["queryDisplayKnowledge", "查询陈列知识"],
      ["deleteDisplayKnowledge", "删除陈列知识"],
    ],
  ],
];

export interface AidgeField {
  name: string;
  apiName: string;
  kind: string;
}
export interface AidgeOperation {
  id: string;
  label: string;
  category: Category;
  fields: AidgeField[];
  documentation: string;
  destructive: boolean;
}

type ModelConstructor = new (map?: Record<string, unknown>) => unknown;
type ModelClass = ModelConstructor & {
  names(): Record<string, string>;
  types(): Record<string, string | { type: string }>;
};
const models = AidgeModels as unknown as Record<string, ModelClass>;
const requestClasses = new Map<string, ModelClass>(
  groups.flatMap(([, entries]) =>
    entries.map(([id]) => [
      id,
      models[`${id[0].toUpperCase()}${id.slice(1)}Request`],
    ]),
  ),
);

export function getAidgeRequestClass(id: string): ModelClass | null {
  return requestClasses.get(id) ?? null;
}

export const aidgeOperations: AidgeOperation[] = groups.flatMap(
  ([category, entries]) =>
    entries.map(([id, label]) => {
      const Request = getAidgeRequestClass(id);
      if (!Request) throw new Error(`Aidge SDK request missing: ${id}`);
      const names = Request.names();
      const types = Request.types();
      return {
        id,
        label,
        category,
        fields: Object.entries(names).map(([name, apiName]) => ({
          name,
          apiName,
          kind:
            typeof types[name] === "string"
              ? (types[name] as string)
              : types[name]?.type || "object",
        })),
        documentation: `https://api.aliyun.com/document/Aidge/2026-04-28/${id[0].toUpperCase()}${id.slice(1)}`,
        destructive: id === "deleteDisplayKnowledge",
      };
    }),
);

export const aidgeOperationById = new Map(
  aidgeOperations.map((operation) => [operation.id, operation]),
);
