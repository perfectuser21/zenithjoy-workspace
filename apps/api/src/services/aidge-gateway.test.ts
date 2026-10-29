import { describe, expect, it } from "vitest";
import { buildAidgeRequest } from "./aidge-gateway";

describe("Aidge SDK 参数构造", () => {
  it("递归映射对象及模型数组，拒绝未声明字段", () => {
    const request = buildAidgeRequest("videoGeneration", {
      input: {
        title: "新品",
        assetBindings: [{ assetIndex: 0, slot: "cover" }],
      },
      output: { duration: 15 },
    });
    expect(request.toMap()).toEqual({
      Input: {
        Title: "新品",
        AssetBindings: [{ AssetIndex: 0, Slot: "cover" }],
      },
      Output: { Duration: 15 },
    });
    expect(() =>
      buildAidgeRequest("videoGeneration", {
        input: { assetBindings: [{ unknown: "x" }] },
      }),
    ).toThrow("参数格式无效");
  });
});
