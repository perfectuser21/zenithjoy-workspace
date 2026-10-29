import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createAidgeRouter } from "./aidge";
import AidgeClient from "@alicloud/aidge20260428";
import { aidgeOperations } from "../services/aidge-catalog";
import { buildAidgeRequest } from "../services/aidge-gateway";
import { InMemoryMaterialStorage } from "../services/material-storage";

function appFor(options: Parameters<typeof createAidgeRouter>[0]) {
  const app = express();
  app.use(express.json());
  app.use("/api/aidge", createAidgeRouter(options));
  return app;
}

describe("Aidge 文本翻译接口", () => {
  it("员工提交文本后返回译文和阿里云请求 ID", async () => {
    const translate = vi.fn().mockResolvedValue({
      text: "Hello",
      detectedLanguage: "zh",
      characters: 2,
      requestId: "req-1",
    });
    const response = await request(
      appFor({ authenticate: async () => "staff-1", translate }),
    )
      .post("/api/aidge/text-translate")
      .send({ text: "你好", sourceLanguage: "auto", targetLanguage: "en" });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      translatedText: "Hello",
      detectedLanguage: "zh",
      characters: 2,
      requestId: "req-1",
    });
    expect(translate).toHaveBeenCalledWith({
      text: "你好",
      sourceLanguage: "auto",
      targetLanguage: "en",
    });
  });

  it("没有员工会话时不调用收费接口", async () => {
    const translate = vi.fn();
    const response = await request(
      appFor({ authenticate: async () => null, translate }),
    )
      .post("/api/aidge/text-translate")
      .send({ text: "你好", targetLanguage: "en" });
    expect(response.status).toBe(401);
    expect(translate).not.toHaveBeenCalled();
  });

  it("拒绝空文本、过长文本和不支持的语言", async () => {
    const translate = vi.fn();
    const app = appFor({ authenticate: async () => "staff-1", translate });
    for (const body of [
      { text: " ", targetLanguage: "en" },
      { text: "字".repeat(5001), targetLanguage: "en" },
      { text: "你好", targetLanguage: "invalid" },
      { text: "你好", targetLanguage: "zh", sourceLanguage: "zh" },
    ]) {
      expect(
        (await request(app).post("/api/aidge/text-translate").send(body))
          .status,
      ).toBe(400);
    }
    expect(translate).not.toHaveBeenCalled();
  });

  it("上游未配置或失败时给可恢复提示，不泄露内部异常", async () => {
    const app = appFor({
      authenticate: async () => "staff-1",
      translate: async () => {
        throw new Error("secret upstream detail");
      },
    });
    const response = await request(app)
      .post("/api/aidge/text-translate")
      .send({ text: "你好", targetLanguage: "en" });
    expect(response.status).toBe(502);
    expect(JSON.stringify(response.body)).not.toContain(
      "secret upstream detail",
    );
  });
});

describe("Aidge 全能力入口", () => {
  it("视频生成的嵌套对象和数组完整映射到 SDK 请求", () => {
    const request = buildAidgeRequest("videoGeneration", {
      input: { title: "新品", images: ["https://example.com/a.png"] },
      intent: { goal: "商品介绍" },
      output: { duration: 15 },
    });
    expect(request.toMap()).toEqual({
      Input: { Title: "新品", Images: ["https://example.com/a.png"] },
      Intent: { Goal: "商品介绍" },
      Output: { Duration: 15 },
    });
    expect(() =>
      buildAidgeRequest("videoGeneration", { input: { unsupported: "x" } }),
    ).toThrow("参数格式无效");
  });
  it("目录覆盖固定 SDK 版本的全部可调用操作", () => {
    const methods = Object.getOwnPropertyNames(AidgeClient.prototype).filter(
      (name) =>
        name !== "constructor" &&
        name !== "getEndpoint" &&
        !name.endsWith("WithOptions"),
    );
    expect(aidgeOperations.map((item) => item.id).sort()).toEqual(
      methods.sort(),
    );
  });
  it("员工能读取 SDK 能力目录并执行白名单接口", async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ Code: "success", Data: { TaskId: "task-1" } });
    const app = appFor({ authenticate: async () => "staff-1", execute });
    const catalog = await request(app).get("/api/aidge/catalog");
    expect(catalog.status).toBe(200);
    expect(catalog.body.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "textTranslate", category: "翻译" }),
        expect.objectContaining({ id: "imageMatting", category: "图片处理" }),
        expect.objectContaining({
          id: "videoGeneration",
          category: "视频生成",
        }),
      ]),
    );
    const response = await request(app)
      .post("/api/aidge/execute")
      .send({
        operation: "imageMatting",
        params: { imageUrl: "https://example.com/a.png" },
      });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      Code: "success",
      Data: { TaskId: "task-1" },
    });
    expect(execute).toHaveBeenCalledWith("imageMatting", {
      imageUrl: "https://example.com/a.png",
    });
  });

  it("拒绝未列入目录的 SDK 方法和未知参数", async () => {
    const execute = vi.fn();
    const app = appFor({ authenticate: async () => "staff-1", execute });
    expect(
      (
        await request(app)
          .post("/api/aidge/execute")
          .send({ operation: "constructor", params: {} })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/aidge/execute")
          .send({
            operation: "imageMatting",
            params: { imageUrl: "https://example.com/a.png", arbitrary: "x" },
          })
      ).status,
    ).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it("删除知识库须由使用者明确确认", async () => {
    const execute = vi.fn().mockResolvedValue({ Code: "success" });
    const app = appFor({ authenticate: async () => "staff-1", execute });
    expect(
      (
        await request(app)
          .post("/api/aidge/execute")
          .send({ operation: "deleteDisplayKnowledge", params: { ragId: "x" } })
      ).status,
    ).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it("员工可上传素材并取得临时地址供 Aidge 读取", async () => {
    const storage = new InMemoryMaterialStorage();
    const app = appFor({ authenticate: async () => "staff-1", storage });
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
    const response = await request(app)
      .post("/api/aidge/upload")
      .attach("file", png, "photo.png");
    expect(response.status).toBe(200);
    expect(response.body.url).toMatch(/^memory:\/\/aidge\//);
    expect(response.body.name).toBe("photo.png");
    expect(
      (
        await request(app)
          .post("/api/aidge/upload")
          .attach("file", Buffer.from("oops"), "photo.png")
      ).status,
    ).toBe(400);
  });
});
