import { describe, expect, it } from "vitest";
import AidgeClient from "@alicloud/aidge20260428";
import { aidgeOperations, getAidgeRequestClass } from "./aidge-catalog";

describe("Aidge 能力目录", () => {
  it("覆盖固定 SDK 的全部公开操作，并保留字段和文档入口", () => {
    const methods = Object.getOwnPropertyNames(AidgeClient.prototype).filter(
      (name) =>
        name !== "constructor" &&
        name !== "getEndpoint" &&
        !name.endsWith("WithOptions"),
    );
    expect(aidgeOperations).toHaveLength(56);
    expect(aidgeOperations.map((item) => item.id).sort()).toEqual(
      methods.sort(),
    );
    const video = aidgeOperations.find((item) => item.id === "videoGeneration");
    expect(video?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "input", kind: "object" }),
      ]),
    );
    expect(video?.documentation).toContain("/VideoGeneration");
    expect(getAidgeRequestClass("constructor")).toBeNull();
    expect(
      aidgeOperations.find((item) => item.id === "deleteDisplayKnowledge")
        ?.destructive,
    ).toBe(true);
  });
});
