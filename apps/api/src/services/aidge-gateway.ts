import { aidgeOperationById, getAidgeRequestClass } from "./aidge-catalog";
import { AidgeTranslationError, makeAidgeClient } from "./aidge-translation";

type ModelClass = (new (values: Record<string, unknown>) => unknown) & {
  names(): Record<string, string>;
  types(): Record<string, unknown>;
};

function isModelClass(value: unknown): value is ModelClass {
  return (
    typeof value === "function" &&
    typeof (value as ModelClass).names === "function" &&
    typeof (value as ModelClass).types === "function"
  );
}

function hydrateValue(type: unknown, value: unknown): unknown {
  if (isModelClass(type)) return hydrateModel(type, value);
  if (type && typeof type === "object") {
    const definition = type as {
      type?: string;
      itemType?: unknown;
      valueType?: unknown;
    };
    if (definition.type === "array") {
      if (!Array.isArray(value)) throw new Error("Expected array");
      return value.map((item) => hydrateValue(definition.itemType, item));
    }
    if (definition.type === "map" && isModelClass(definition.valueType)) {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Expected map");
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          hydrateValue(definition.valueType, item),
        ]),
      );
    }
  }
  return value;
}

function hydrateModel(Model: ModelClass, values: unknown): unknown {
  if (!values || typeof values !== "object" || Array.isArray(values))
    throw new Error("Expected object");
  const names = Model.names();
  const types = Model.types();
  const input = values as Record<string, unknown>;
  if (Object.keys(input).some((key) => !Object.prototype.hasOwnProperty.call(names, key)))
    throw new Error("Unknown model field");
  return new Model(
    Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        key,
        hydrateValue(types[key], value),
      ]),
    ),
  );
}

export function buildAidgeRequest(
  operation: string,
  params: Record<string, unknown>,
): { validate(): void; toMap(): Record<string, unknown> } {
  const Request = getAidgeRequestClass(operation);
  if (!Request) throw new AidgeTranslationError(400, "不支持此 Aidge 能力");
  try {
    const request = hydrateModel(Request as ModelClass, params) as {
      validate(): void;
      toMap(): Record<string, unknown>;
    };
    request.validate();
    return request;
  } catch {
    throw new AidgeTranslationError(
      400,
      "参数格式无效，请对照官方接口文档检查",
    );
  }
}

export async function runAidgeOperation(
  operation: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const spec = aidgeOperationById.get(operation);
  if (!spec || !getAidgeRequestClass(operation))
    throw new AidgeTranslationError(400, "不支持此 Aidge 能力");
  const allowed = new Set(spec.fields.map((field) => field.name));
  if (Object.keys(params).some((key) => !allowed.has(key)))
    throw new AidgeTranslationError(400, "请求包含不支持的参数");
  const request = buildAidgeRequest(operation, params);

  const client = makeAidgeClient();
  try {
    const method = (
      client as unknown as Record<
        string,
        (request: unknown) => Promise<{ body?: unknown }>
      >
    )[operation];
    const response = await method.call(client, request);
    const body = response.body as
      | { code?: string; success?: boolean }
      | undefined;
    if (!body)
      throw new AidgeTranslationError(502, "Aidge 返回了空结果，请稍后重试");
    if (body.success === false || (body.code && body.code !== "success")) {
      if (body.code === "FreeQuotaExhausted")
        throw new AidgeTranslationError(503, "Aidge 额度已用尽，请联系管理员");
      if (body.code === "Throttling")
        throw new AidgeTranslationError(429, "请求过于频繁，请稍后重试");
      if (body.code === "InputContentBlocked")
        throw new AidgeTranslationError(
          422,
          "素材未通过 Aidge 内容检查，请更换后重试",
        );
      throw new AidgeTranslationError(
        502,
        "Aidge 暂时无法处理此请求，请检查参数或稍后重试",
      );
    }
    return body;
  } catch (error) {
    if (error instanceof AidgeTranslationError) throw error;
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 403 || (error as { code?: string }).code === "NoPermission")
      throw new AidgeTranslationError(
        503,
        "Aidge RAM 账号尚未授权，请联系管理员",
      );
    if (status === 429)
      throw new AidgeTranslationError(429, "请求过于频繁，请稍后重试");
    if (status === 400)
      throw new AidgeTranslationError(
        400,
        "参数格式无效，请对照官方接口文档检查",
      );
    throw new AidgeTranslationError(
      502,
      "Aidge 暂时无法处理此请求，请稍后重试",
    );
  }
}
