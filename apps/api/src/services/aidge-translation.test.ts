import { afterEach, describe, expect, it, vi } from "vitest";
import AidgeClient from "@alicloud/aidge20260428";
import { AidgeTranslationError, translateAidgeText } from "./aidge-translation";

const previousId = process.env.AIDGE_ACCESS_KEY_ID;
const previousSecret = process.env.AIDGE_ACCESS_KEY_SECRET;

afterEach(() => {
  vi.restoreAllMocks();
  if (previousId === undefined) delete process.env.AIDGE_ACCESS_KEY_ID;
  else process.env.AIDGE_ACCESS_KEY_ID = previousId;
  if (previousSecret === undefined) delete process.env.AIDGE_ACCESS_KEY_SECRET;
  else process.env.AIDGE_ACCESS_KEY_SECRET = previousSecret;
});

describe("Aidge 文本翻译 SDK", () => {
  it("缺少服务端密钥时停止调用", async () => {
    delete process.env.AIDGE_ACCESS_KEY_ID;
    delete process.env.AIDGE_ACCESS_KEY_SECRET;
    await expect(
      translateAidgeText({
        text: "你好",
        sourceLanguage: "auto",
        targetLanguage: "en",
      }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("发送正确请求并返回译文，权限错误给出明确提示", async () => {
    process.env.AIDGE_ACCESS_KEY_ID = "test-id";
    process.env.AIDGE_ACCESS_KEY_SECRET = "test-secret";
    const call = vi.spyOn(AidgeClient.prototype, "textTranslate");
    call.mockResolvedValueOnce({
      body: {
        code: "success",
        success: true,
        requestId: "req-1",
        data: { translations: [{ translatedText: "Hello" }] },
      },
    } as never);
    await expect(
      translateAidgeText({
        text: "你好",
        sourceLanguage: "auto",
        targetLanguage: "en",
      }),
    ).resolves.toMatchObject({ text: "Hello", requestId: "req-1" });
    expect(call.mock.calls[0][0].toMap()).toMatchObject({
      SourceTextList: ["你好"],
      TargetLanguage: "en",
      FormatType: "text",
    });
    call.mockRejectedValueOnce({ code: "NoPermission", statusCode: 403 });
    await expect(
      translateAidgeText({
        text: "你好",
        sourceLanguage: "auto",
        targetLanguage: "en",
      }),
    ).rejects.toEqual(
      new AidgeTranslationError(503, "Aidge RAM 账号尚未授权，请联系管理员"),
    );
  });
});
