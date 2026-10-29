import AidgeClient, { TextTranslateRequest } from "@alicloud/aidge20260428";
import { $OpenApiUtil } from "@alicloud/openapi-core";

export interface TranslateInput {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
}

export interface TranslateResult {
  text: string;
  detectedLanguage?: string;
  characters?: number;
  requestId?: string;
}

export class AidgeTranslationError extends Error {
  constructor(
    public readonly status: number,
    public readonly publicMessage: string,
  ) {
    super(publicMessage);
  }
}

export function makeAidgeClient(): AidgeClient {
  const accessKeyId = process.env.AIDGE_ACCESS_KEY_ID;
  const accessKeySecret = process.env.AIDGE_ACCESS_KEY_SECRET;
  if (!accessKeyId || !accessKeySecret) {
    throw new AidgeTranslationError(503, "Aidge 尚未配置，请联系管理员");
  }

  return new AidgeClient(
    new $OpenApiUtil.Config({
      accessKeyId,
      accessKeySecret,
      endpoint: "aidge.cn-beijing.aliyuncs.com",
      regionId: "cn-beijing",
      protocol: "HTTPS",
      connectTimeout: 5000,
      readTimeout: 35000,
    }),
  );
}

export async function translateAidgeText(
  input: TranslateInput,
): Promise<TranslateResult> {
  const client = makeAidgeClient();
  const request = new TextTranslateRequest({
    sourceTextList: [input.text],
    targetLanguage: input.targetLanguage,
    formatType: "text",
    ...(input.sourceLanguage === "auto"
      ? {}
      : { sourceLanguage: input.sourceLanguage }),
  });
  try {
    const response = await client.textTranslate(request);
    const body = response.body;
    if (body?.code !== "success" || body.success === false) {
      const code = body?.code;
      if (code === "InputContentBlocked")
        throw new AidgeTranslationError(422, "这段文字无法翻译，请修改后重试");
      if (code === "FreeQuotaExhausted")
        throw new AidgeTranslationError(
          503,
          "Aidge 翻译额度已用尽，请联系管理员",
        );
      if (code === "Throttling")
        throw new AidgeTranslationError(429, "翻译请求过于频繁，请稍后重试");
      throw new AidgeTranslationError(502, "翻译服务暂时不可用，请稍后重试");
    }
    const translation = body.data?.translations?.[0];
    if (
      body.data?.translations?.length !== 1 ||
      typeof translation?.translatedText !== "string"
    ) {
      throw new AidgeTranslationError(502, "翻译结果无效，请稍后重试");
    }
    return {
      text: translation.translatedText,
      detectedLanguage: translation.detectedLanguage,
      characters: translation.characters,
      requestId: body.requestId,
    };
  } catch (error) {
    if (error instanceof AidgeTranslationError) throw error;
    const code = (error as { code?: string; statusCode?: number }).code;
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode === 403 || code === "NoPermission")
      throw new AidgeTranslationError(
        503,
        "Aidge RAM 账号尚未授权，请联系管理员",
      );
    if (statusCode === 429 || code === "Throttling")
      throw new AidgeTranslationError(429, "翻译请求过于频繁，请稍后重试");
    throw new AidgeTranslationError(502, "翻译服务暂时不可用，请稍后重试");
  }
}
