// apps/api/src/services/embedding.ts
//
// 批量混剪 S3（GP f6f96e17）本地 embedding 服务。
//
// Gate0 实测（决策 98d1fab1）：TOAPIS/Gemini 代理零 embedding 模型访问权限
// （163 个可用模型无一含 embed），改用本地开源模型，零第三方账号依赖、零成本。
// 模型 Xenova/paraphrase-multilingual-MiniLM-L12-v2：多语言、384 维、CPU 可跑。
//
// pipeline 首次调用会现下模型（几十 MB，缓存到 ~/.cache/huggingface，同进程
// 内单例复用，不重复下载/初始化）。

import { pipeline } from '@xenova/transformers';

type Extractor = (text: string, opts: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array | number[] }>;

let extractorPromise: Promise<Extractor> | null = null;

function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = pipeline(
      'feature-extraction',
      'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    ) as unknown as Promise<Extractor>;
  }
  return extractorPromise;
}

/** 把文本编成句向量（mean pooling + 归一化）。 */
export async function embedText(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const out = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

/** 余弦相似度。两向量归一化后点积即为余弦值。维度不一致直接抛错，不静默算错。 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: dimension mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
