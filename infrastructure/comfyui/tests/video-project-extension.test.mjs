import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const assetId = "11111111-1111-4111-8111-111111111111";
const jobId = "22222222-2222-4222-8222-222222222222";
class Element {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.style = {};
    this.listeners = {};
    this.textContent = "";
    this.dataset = {};
  }
  append(...children) {
    this.children.push(...children);
  }
  appendChild(child) {
    this.append(child);
    return child;
  }
  replaceChildren(...children) {
    this.children = children;
  }
  addEventListener(name, callback) {
    this.listeners[name] = callback;
  }
  remove() {
    this.removed = true;
  }
  click() {
    this.onclick?.({ stopPropagation() {} });
  }
  setAttribute(name, value) {
    this[name] = value;
  }
}
function descendants(element) {
  return [element, ...element.children.flatMap(descendants)];
}
async function fixture(
  fetch = async () => {
    throw new Error("Unexpected network call");
  },
  files = ["identifiers.js", "video-project.js"],
) {
  const extensions = [],
    elements = [];
  const graph = {
    nodes: new Map(),
    links: {},
    getNodeById(id) {
      return this.nodes.get(id);
    },
  };
  const app = {
    graph,
    registerExtension(extension) {
      extensions.push(extension);
    },
  };
  const context = vm.createContext({
    fetch,
    FormData,
    console,
    crypto,
    document: {
      createElement(tag) {
        const element = new Element(tag);
        elements.push(element);
        return element;
      },
    },
  });
  for (const filename of files) {
    const module = new vm.SourceTextModule(
      await readFile(
        new URL(`custom_nodes/zenithjoy/web/${filename}`, root),
        "utf8",
      ),
      { context },
    );
    await module.link(async (name) => {
      assert.equal(name, "../../scripts/app.js");
      return new vm.SyntheticModule(
        ["app"],
        function () {
          this.setExport("app", app);
        },
        { context },
      );
    });
    await module.evaluate();
  }
  let serial = 0;
  async function node(type, fields) {
    class Node {
      constructor() {
        this.id = ++serial;
        this.type = type;
        this.widgets = Object.entries(fields).map(([name, value]) => ({
          name,
          value,
          callback() {},
        }));
        this.inputs = [];
        this.outputs = [{ links: [] }];
        this.graph = graph;
        this.size = [470, 500];
      }
      addWidget(type, name, value, callback, options) {
        const widget = { type, name, value, callback, options };
        this.widgets.push(widget);
        return widget;
      }
      addDOMWidget(name, type, element, options) {
        const widget = { name, type, element, options };
        this.widgets.push(widget);
        return widget;
      }
      setDirtyCanvas() {}
      setSize(size) {
        this.size = size;
      }
    }
    for (const extension of extensions)
      await extension.beforeRegisterNodeDef?.(Node, { name: type });
    const result = new Node();
    graph.nodes.set(result.id, result);
    result.onNodeCreated?.();
    return result;
  }
  function connect(from, to) {
    const id = Object.keys(graph.links).length + 1;
    graph.links[id] = { origin_id: from.id, target_id: to.id, target_slot: 0 };
    from.outputs[0].links.push(id);
    to.inputs[0] = { link: id };
  }
  return {
    node,
    connect,
    elements,
    field: (node, name) => node.widgets.find((widget) => widget.name === name),
    dom: (node) => node.widgets.find((widget) => widget.element)?.element,
  };
}

test("whole-video upload lives on native node, uses staff session and hides only serialized asset identity", async () => {
  const calls = [];
  const f = await fixture(async (path, options) => {
    calls.push({ path, options });
    return {
      ok: true,
      json: async () => ({ id: assetId, kind: "video", name: "整片.mp4" }),
    };
  });
  const source = await f.node("ZenithJoyVideoProject", {
    原片视频ID: "",
    request_id: "",
  });
  const upload = f.field(source, "上传完整视频");
  assert.ok(upload, "node needs a whole-video upload button");
  upload.callback();
  const input = f.elements.find((element) => element.tagName === "input");
  input.files = [new File(["video"], "整片.mp4", { type: "video/mp4" })];
  await input.onchange();
  assert.equal(calls[0].path, "/api/video-tools/uploads");
  assert.equal(calls[0].options.credentials, "include");
  assert.ok(calls[0].options.body instanceof FormData);
  assert.equal(calls[0].options.headers, undefined);
  const asset = f.field(source, "原片视频ID");
  assert.equal(asset.value, assetId);
  assert.deepEqual(Array.from(asset.computeSize()), [0, -4]);
  assert.equal(await asset.serializeValue(), assetId);
  assert.match(f.field(source, "request_id").value, /^[a-f0-9]{32}$/);
});

test("scene cards select a native connected segment and invalidate old confirmation", async () => {
  const f = await fixture();
  const source = await f.node("ZenithJoyVideoProject", {
    原片视频ID: assetId,
    request_id: "",
  });
  const selector = await f.node("ZenithJoyVideoSegment", {
    分镜序号: 1,
    确认分镜: true,
  });
  f.connect(source, selector);
  source.onExecuted({
    project: [
      {
        id: "project-1",
        name: "完整原片",
        segments: [
          {
            id: "seg-1",
            start: 0,
            end: 8,
            videoUrl: "https://media.example/1.mp4",
          },
          {
            id: "seg-2",
            start: 8,
            end: 20,
            videoUrl: "https://media.example/2.mp4",
          },
        ],
      },
    ],
  });
  const preview = f.dom(source);
  assert.ok(preview, "project should render native DOM preview");
  assert.equal(
    descendants(preview).filter((element) => element.tagName === "video")
      .length,
    2,
  );
  const select = descendants(preview).find(
    (element) =>
      element.tagName === "button" && /片段 2/.test(element.textContent),
  );
  assert.ok(select);
  select.click();
  assert.equal(f.field(selector, "分镜序号").value, 2);
  assert.equal(f.field(selector, "确认分镜").value, false);
  f.field(selector, "确认当前分镜").callback();
  assert.equal(f.field(selector, "确认分镜").value, true);
});

test("approval is tied to the actual latest upstream result and clears on scene or generation changes", async () => {
  const f = await fixture();
  const selector = await f.node("ZenithJoyVideoSegment", {
    分镜序号: 1,
    确认分镜: true,
  });
  const remake = await f.node("ZenithJoySegmentRemake", {
    产品操作: "保留产品",
    产品图片ID: "",
    背景图片ID: "",
    人脸图片ID: "",
    更换背景: false,
    确认生成: true,
    request_id: "",
  });
  const approval = await f.node("ZenithJoyApproveSegment", {
    审核任务ID: "old-job",
  });
  f.connect(selector, remake);
  f.connect(remake, approval);
  remake.onExecuted({
    edited: [
      {
        projectId: "project-1",
        segmentId: "seg-1",
        jobId,
        videoUrl: "https://media.example/result.mp4",
      },
    ],
  });
  assert.equal(
    f.field(approval, "审核任务ID").value,
    "",
    "old approval must not carry over to a new result",
  );
  assert.ok(
    descendants(f.dom(approval)).some(
      (element) =>
        element.tagName === "video" &&
        element.src === "https://media.example/result.mp4",
    ),
  );
  f.field(approval, "确认使用当前结果").callback();
  assert.equal(f.field(approval, "审核任务ID").value, jobId);
  f.field(selector, "分镜序号").value = 2;
  f.field(selector, "分镜序号").callback(2);
  assert.equal(f.field(approval, "审核任务ID").value, "");
  assert.equal(f.field(remake, "确认生成").value, false);
  f.field(approval, "确认使用当前结果").callback();
  assert.equal(
    f.field(approval, "审核任务ID").value,
    "",
    "no cached result may be approved after changing the source segment",
  );
});

test("explicit generation and assembly checkpoints stay enabled while clearing old outputs", async () => {
  const f = await fixture();
  const remake = await f.node("ZenithJoySegmentRemake", {
    产品操作: "保留产品",
    确认生成: false,
    request_id: "",
  });
  const assembly = await f.node("ZenithJoyAssembleVideo", { 确认合成: false });
  f.field(remake, "确认生成").value = true;
  f.field(remake, "确认生成").callback(true);
  assert.equal(
    f.field(remake, "确认生成").value,
    true,
    "user must be able to opt into generation",
  );
  f.field(assembly, "确认合成").value = true;
  f.field(assembly, "确认合成").callback(true);
  assert.equal(
    f.field(assembly, "确认合成").value,
    true,
    "user must be able to opt into assembly",
  );
});

test("uploads reject HTTP errors without replacing the last valid asset", async () => {
  const f = await fixture(async () => ({ ok: false, status: 413 }));
  const source = await f.node("ZenithJoyVideoProject", {
    原片视频ID: assetId,
    request_id: "",
  });
  f.field(source, "上传完整视频").callback();
  const input = f.elements.find((element) => element.tagName === "input");
  input.files = [new File(["video"], "整片.mp4", { type: "video/mp4" })];
  await input.onchange();
  assert.equal(f.field(source, "原片视频ID").value, assetId);
  assert.match(f.field(source, "工作流提示").value, /413/);
});

test("removing a whole-video node during upload never writes completion to detached widgets", async () => {
  let finish;
  const f = await fixture(async () => {
    await new Promise((resolve) => {
      finish = resolve;
    });
    return { ok: true, json: async () => ({ id: assetId, kind: "video" }) };
  });
  const source = await f.node("ZenithJoyVideoProject", {
    原片视频ID: "",
    request_id: "",
  });
  f.field(source, "上传完整视频").callback();
  const input = f.elements.find((element) => element.tagName === "input");
  input.files = [new File(["video"], "整片.mp4", { type: "video/mp4" })];
  const upload = input.onchange();
  assert.equal(f.field(source, "原片视频ID").value, "上传中");
  source.onRemoved();
  finish();
  await upload;
  assert.equal(f.field(source, "原片视频ID").value, "上传中");
});

test("short-video template retains native typed links and stops before every paid or approval action", async () => {
  const graph = JSON.parse(
    await readFile(new URL("workflows/short-video-wan.json", root), "utf8"),
  );
  const nodes = [
    "ZenithJoyVideoProject",
    "ZenithJoyVideoSegment",
    "ZenithJoySegmentRemake",
    "ZenithJoyApproveSegment",
    "ZenithJoyAssembleVideo",
    "SaveVideo",
  ].map((type) => graph.nodes.find((node) => node.type === type));
  nodes.forEach((node, i) => assert.ok(node, `missing node ${i}`));
  const types = [
    "ZJ_VIDEO_PROJECT",
    "ZJ_VIDEO_SEGMENT",
    "ZJ_EDITED_SEGMENT",
    "ZJ_VIDEO_PROJECT",
    "VIDEO",
  ];
  for (let i = 0; i < types.length; i++)
    assert.ok(
      graph.links.some(
        (link) =>
          link[1] === nodes[i].id &&
          link[3] === nodes[i + 1].id &&
          link[5] === types[i],
      ),
    );
  assert.equal(nodes[1].widgets_values_named["确认分镜"], false);
  assert.equal(nodes[2].widgets_values_named["确认生成"], false);
  assert.equal(nodes[3].widgets_values_named["审核任务ID"], "");
  assert.equal(nodes[4].widgets_values_named["确认合成"], false);
  assert.equal(nodes[0].widgets_values_named.request_id, "");
  assert.equal(nodes[2].widgets_values_named.request_id, "");
  const docker = await readFile(new URL("Dockerfile", root), "utf8");
  assert.match(
    docker,
    /COPY infrastructure\/comfyui\/workflows\/short-video-wan.json/,
  );
});

for (const files of [
  ["identifiers.js", "video-project.js"],
  ["video-project.js", "identifiers.js"],
]) {
  test(`new-version invalidates downstream approval in extension order ${files.join(" → ")}`, async () => {
    const f = await fixture(undefined, files);
    const remake = await f.node("ZenithJoySegmentRemake", {
      确认生成: false,
      request_id: "",
    });
    const approval = await f.node("ZenithJoyApproveSegment", {
      审核任务ID: "",
    });
    f.connect(remake, approval);
    f.field(remake, "确认生成").value = true;
    f.field(approval, "审核任务ID").value = jobId;
    const original = f.field(remake, "request_id").value;
    f.field(remake, "生成新版本").callback();
    assert.notEqual(f.field(remake, "request_id").value, original);
    assert.equal(f.field(remake, "确认生成").value, false);
    assert.equal(f.field(approval, "审核任务ID").value, "");
  });
}

for (const files of [
  ["identifiers.js", "video-project.js"],
  ["video-project.js", "identifiers.js"],
]) {
  test(`new project clears every downstream checkpoint in extension order ${files.join(" → ")}`, async () => {
    const f = await fixture(undefined, files);
    const source = await f.node("ZenithJoyVideoProject", {
      原片视频ID: assetId,
      request_id: "",
    });
    const selector = await f.node("ZenithJoyVideoSegment", {
      分镜序号: 1,
      确认分镜: false,
    });
    const remake = await f.node("ZenithJoySegmentRemake", {
      确认生成: false,
      request_id: "",
    });
    const approval = await f.node("ZenithJoyApproveSegment", {
      审核任务ID: "",
    });
    const assembly = await f.node("ZenithJoyAssembleVideo", {
      确认合成: false,
    });
    f.connect(source, selector);
    f.connect(selector, remake);
    f.connect(remake, approval);
    f.connect(approval, assembly);
    f.field(selector, "确认分镜").value = true;
    f.field(remake, "确认生成").value = true;
    f.field(approval, "审核任务ID").value = jobId;
    f.field(assembly, "确认合成").value = true;
    f.field(source, "新建视频项目").callback();
    assert.equal(f.field(selector, "确认分镜").value, false);
    assert.equal(f.field(remake, "确认生成").value, false);
    assert.equal(f.field(approval, "审核任务ID").value, "");
    assert.equal(f.field(assembly, "确认合成").value, false);
  });
}
