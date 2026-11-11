import { app } from "../../scripts/app.js";

// Native Comfy nodes remain movable and connectable; these widgets only expose
// owned uploads, scene previews and explicit human checkpoints inside each node.
const TYPES = new Set([
  "ZenithJoyVideoProject",
  "ZenithJoyVideoSegment",
  "ZenithJoySegmentRemake",
  "ZenithJoyApproveSegment",
  "ZenithJoyAssembleVideo",
]);
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const field = (node, name) =>
  node.widgets?.find((widget) => widget.name === name);
const touch = (node) => node.setDirtyCanvas?.(true, true);
function newRequest(node) {
  const request = field(node, "request_id");
  if (!request) return;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  request.value = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
function hide(widget) {
  if (!widget) return;
  widget.type = "hidden";
  widget.computeSize = () => [0, -4];
  // Hidden execution inputs must still survive saving/reloading the graph.
  widget.serializeValue = () => widget.value;
}
function children(node) {
  const graph = node.graph ?? app.graph;
  return (node.outputs ?? [])
    .flatMap((output) => output.links ?? [])
    .map((id) => {
      const link = graph?.links?.[id];
      return graph?.getNodeById?.(link?.target_id ?? link?.[3]);
    })
    .filter(Boolean);
}
function upstream(node) {
  const graph = node.graph ?? app.graph;
  const link = graph?.links?.[node.inputs?.[0]?.link];
  return graph?.getNodeById?.(link?.origin_id ?? link?.[1]);
}
function descendants(node) {
  const result = [],
    pending = [...children(node)],
    seen = new Set([node]);
  while (pending.length && seen.size < 500) {
    const child = pending.shift();
    if (seen.has(child)) continue;
    seen.add(child);
    result.push(child);
    pending.push(...children(child));
  }
  return result;
}
function status(node, message) {
  const widget = field(node, "工作流提示");
  if (widget) widget.value = message;
  touch(node);
}
function clearResult(node) {
  node.__zjEdited = null;
  node.__zjProject = null;
  node.__zjConflict = false;
  if (field(node, "确认分镜")) field(node, "确认分镜").value = false;
  if (field(node, "审核任务ID")) field(node, "审核任务ID").value = "";
  if (field(node, "确认生成")) field(node, "确认生成").value = false;
  if (field(node, "确认合成")) field(node, "确认合成").value = false;
  if (node.__zjPreview) node.__zjPreview.replaceChildren();
  touch(node);
}
function invalidate(node, clearSelf = true) {
  if (clearSelf) clearResult(node);
  for (const child of descendants(node)) clearResult(child);
}
function element(tag, text = "") {
  const result = document.createElement(tag);
  result.textContent = text;
  return result;
}
function video(url) {
  if (
    typeof url !== "string" ||
    (!url.startsWith("https://") && !url.startsWith("/api/video-tools/"))
  )
    return null;
  const result = element("video");
  result.src = url;
  result.controls = true;
  result.preload = "metadata";
  Object.assign(result.style, {
    width: "100%",
    maxHeight: "210px",
    background: "#09090b",
    borderRadius: "8px",
    display: "block",
  });
  return result;
}
function preview(node) {
  if (node.__zjPreview) return node.__zjPreview;
  const container = element("div");
  Object.assign(container.style, {
    padding: "6px",
    overflowY: "auto",
    maxHeight: "360px",
    color: "#e2e8f0",
    font: "12px/1.6 system-ui",
    boxSizing: "border-box",
    width: "100%",
  });
  container.addEventListener("pointerdown", (event) => event.stopPropagation());
  container.addEventListener("wheel", (event) => event.stopPropagation());
  if (node.addDOMWidget) {
    const widget = node.addDOMWidget(
      "视频与分镜预览",
      "zenithjoy-video-preview",
      container,
      { serialize: false, hideOnZoom: false },
    );
    widget.computeSize = (width) => [width || 450, 240];
  }
  node.__zjPreview = container;
  return container;
}
function readUI(message, key) {
  const value = message?.[key]?.[0];
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" ? value : null;
}
function renderEdited(node, edited) {
  const container = preview(node);
  container.replaceChildren();
  if (!edited?.jobId || !UUID.test(edited.jobId)) return;
  const player = video(edited.videoUrl);
  if (player) container.append(player);
  container.append(
    element("p", "请播放并检查当前结果，满意后点击“确认使用当前结果”。"),
  );
}
function renderProject(node, project) {
  const container = preview(node);
  container.replaceChildren();
  for (const [index, segment] of (project.segments ?? []).entries()) {
    const card = element("div");
    Object.assign(card.style, {
      marginBottom: "12px",
      padding: "10px",
      border: "1px solid #475569",
      borderRadius: "10px",
    });
    card.append(
      element(
        "strong",
        `片段 ${index + 1} · ${(segment.end - segment.start).toFixed(1)} 秒${segment.approved ? " · 已审核" : ""}`,
      ),
    );
    card.append(
      element(
        "p",
        `${Number(segment.start).toFixed(1)} → ${Number(segment.end).toFixed(1)} 秒`,
      ),
    );
    const player = video(segment.videoUrl);
    if (player) card.append(player);
    const choose = element("button", `选择片段 ${index + 1}`);
    Object.assign(choose.style, {
      marginTop: "8px",
      padding: "6px 12px",
      cursor: "pointer",
      borderRadius: "6px",
    });
    choose.onclick = (event) => {
      event.stopPropagation();
      const selectors = children(node).filter(
        (child) => child.type === "ZenithJoyVideoSegment",
      );
      if (!selectors.length) {
        status(node, "请先把视频项目输出连到“选择分镜”节点");
        return;
      }
      for (const selector of selectors) {
        const selected = field(selector, "分镜序号");
        if (selected) selected.value = index + 1;
        if (field(selector, "确认分镜"))
          field(selector, "确认分镜").value = false;
        invalidate(selector);
        selector.__zjProject = project;
        renderSegment(
          selector,
          { projectId: project.id, ...segment },
          index + 1,
        );
        status(
          selector,
          `已选择片段 ${index + 1}，检查后点击“确认当前分镜”再运行`,
        );
      }
    };
    card.append(choose);
    container.append(card);
  }
  status(
    node,
    project.error ||
      `${project.name || "视频项目"} · ${project.segments?.length ?? 0} 个分镜。选择片段后继续。`,
  );
}
function renderSegment(node, segment, ordinal) {
  const container = preview(node);
  container.replaceChildren();
  container.append(
    element(
      "p",
      `片段 ${ordinal} · ${Number(segment.start).toFixed(1)} → ${Number(segment.end).toFixed(1)} 秒`,
    ),
  );
  const player = video(segment.videoUrl);
  if (player) container.append(player);
}
function addUpload(node, label, name, kind) {
  node.addWidget(
    "button",
    label,
    null,
    () => {
      if (node.__zjUploading || node.__zjRemoved) {
        status(node, "素材上传中，请等待完成");
        return;
      }
      const input = element("input");
      input.type = "file";
      input.accept =
        kind === "video" ? ".mp4,.mov,.webm" : ".png,.jpg,.jpeg,.webp";
      input.onchange = async () => {
        const file = input.files?.[0],
          target = field(node, name);
        if (!file || !target || node.__zjRemoved || node.__zjUploading) return;
        const valid =
          kind === "video"
            ? /\.(mp4|mov|webm)$/i.test(file.name)
            : /\.(png|jpe?g|webp)$/i.test(file.name);
        if (
          !valid ||
          !file.size ||
          file.size > (kind === "video" ? 100 : 20) * 1024 * 1024
        ) {
          status(
            node,
            kind === "video"
              ? "请选择不超过 100 MB 的 MP4、MOV 或 WebM 视频"
              : "请选择不超过 20 MB 的 PNG、JPG 或 WebP 图片",
          );
          return;
        }
        const old = target.value;
        node.__zjUploading = true;
        target.value = "上传中";
        invalidate(node);
        status(node, `正在上传 ${file.name}，请等待完成后运行`);
        try {
          const body = new FormData();
          body.append("file", file);
          const response = await fetch("/api/video-tools/uploads", {
            method: "POST",
            credentials: "include",
            body,
          });
          if (!response.ok)
            throw new Error(
              `上传失败（HTTP ${response.status}），请检查登录、文件大小后重试`,
            );
          const asset = await response.json();
          if (
            asset.kind !== kind ||
            typeof asset.id !== "string" ||
            !UUID.test(asset.id)
          )
            throw new Error("返回的素材类型无效，请重新上传");
          if (!node.__zjRemoved) {
            target.value = asset.id;
            if (kind === "video" && old !== asset.id) {
              newRequest(node);
            }
            status(
              node,
              `${file.name} 上传完成。${kind === "video" ? "点击运行开始自动分镜。" : "素材已准备好，请确认修改内容后运行。"}`,
            );
          }
        } catch (error) {
          if (!node.__zjRemoved) {
            target.value = old;
            status(
              node,
              error instanceof Error ? error.message : "上传失败，请稍后重试",
            );
          }
        } finally {
          node.__zjUploading = false;
          input.remove();
        }
      };
      input.click();
    },
    { serialize: false },
  );
}

app.registerExtension({
  name: "ZenithJoy.VideoProjects",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (!TYPES.has(nodeData.name)) return;
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = created?.apply(this, arguments),
        node = this;
      node.__zjRequestChanged = () => invalidate(node);
      node.addWidget(
        "text",
        "工作流提示",
        "上传或连接素材，按节点上的提示继续",
        () => {},
        { serialize: false },
      );
      for (const name of [
        "原片视频ID",
        "产品图片ID",
        "背景图片ID",
        "人脸图片ID",
        "审核任务ID",
        "request_id",
      ])
        hide(field(node, name));
      preview(node);
      if (nodeData.name === "ZenithJoyVideoProject")
        addUpload(node, "上传完整视频", "原片视频ID", "video");
      if (nodeData.name === "ZenithJoySegmentRemake") {
        addUpload(node, "上传产品或Logo图片", "产品图片ID", "image");
        addUpload(node, "上传背景图片", "背景图片ID", "image");
        addUpload(node, "上传人脸图片", "人脸图片ID", "image");
      }
      if (nodeData.name === "ZenithJoyVideoSegment")
        node.addWidget(
          "button",
          "确认当前分镜",
          null,
          () => {
            if (field(node, "确认分镜")) field(node, "确认分镜").value = true;
            invalidate(node, false);
            status(
              node,
              "已确认当前分镜。设置下游修改要求，打开“确认生成”后运行。",
            );
          },
          { serialize: false },
        );
      if (nodeData.name === "ZenithJoyApproveSegment")
        node.addWidget(
          "button",
          "确认使用当前结果",
          null,
          () => {
            const current = upstream(node)?.__zjEdited;
            if (
              node.__zjConflict ||
              !current?.jobId ||
              !UUID.test(current.jobId) ||
              !current.videoUrl
            ) {
              status(node, "请先生成并预览当前分镜；没有可审核的新结果");
              return;
            }
            node.__zjEdited = current;
            field(node, "审核任务ID").value = current.jobId;
            status(
              node,
              "已确认使用当前结果。运行可保存审核；所有分镜审核后打开“确认合成”。",
            );
          },
          { serialize: false },
        );
      for (const widget of node.widgets ?? []) {
        if (
          [
            "视频与分镜预览",
            "工作流提示",
            "确认当前分镜",
            "确认使用当前结果",
            "审核任务ID",
            "生成新版本",
            "新建视频项目",
          ].includes(widget.name) ||
          widget.name.startsWith("上传")
        )
          continue;
        const previous = widget.callback;
        widget.callback = function () {
          const value = previous?.apply(this, arguments);
          const chosen = widget.value;
          if (widget.name === "确认分镜") invalidate(node, false);
          else invalidate(node);
          if (["确认生成", "确认合成"].includes(widget.name))
            widget.value = chosen;
          if (widget.name === "分镜序号") {
            if (field(node, "确认分镜")) field(node, "确认分镜").value = false;
            const project = upstream(node)?.__zjProject;
            const selected = project?.segments?.[Number(widget.value) - 1];
            if (selected)
              renderSegment(
                node,
                { projectId: project.id, ...selected },
                Number(widget.value),
              );
          }
          return value;
        };
      }
      const removed = node.onRemoved;
      node.onRemoved = function () {
        node.__zjRemoved = true;
        return removed?.apply(this, arguments);
      };
      return result;
    };
    const executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      executed?.apply(this, arguments);
      if (this.__zjRemoved) return;
      const project = readUI(message, "project"),
        segment = readUI(message, "segment"),
        edited = readUI(message, "edited");
      if (project) {
        const fingerprint = `${project.id}:${(project.segments ?? []).map((item) => item.id).join(",")}`;
        if (
          this.__zjProjectFingerprint &&
          this.__zjProjectFingerprint !== fingerprint
        ) {
          invalidate(this);
        }
        this.__zjProjectFingerprint = fingerprint;
        this.__zjProject = project;
        if (nodeData.name === "ZenithJoyVideoProject")
          renderProject(this, project);
        else if (nodeData.name === "ZenithJoyApproveSegment" && this.__zjEdited)
          renderEdited(this, this.__zjEdited);
        else if (nodeData.name === "ZenithJoyAssembleVideo") {
          const container = preview(this);
          container.replaceChildren();
          container.append(
            element(
              "p",
              `已审核 ${(project.segments ?? []).filter((item) => item.approved).length} / ${project.segments?.length ?? 0} 个分镜。`,
            ),
          );
        }
      }
      if (segment)
        renderSegment(
          this,
          segment,
          Number(field(this, "分镜序号")?.value || 1),
        );
      if (edited) {
        if (edited.currentJobId && edited.currentJobId !== edited.jobId) {
          clearResult(this);
          this.__zjConflict = true;
          status(
            this,
            "此分镜已切换到其他生成版本，请重新运行生成节点，预览当前结果后再审核。",
          );
          return;
        }
        if (
          field(this, "审核任务ID")?.value !== edited.jobId &&
          field(this, "审核任务ID")
        )
          field(this, "审核任务ID").value = "";
        const changed = this.__zjEdited?.jobId !== edited.jobId;
        this.__zjEdited = edited;
        renderEdited(this, edited);
        for (const child of descendants(this).filter(
          (child) => child.type === "ZenithJoyApproveSegment",
        )) {
          if (changed || field(child, "审核任务ID")?.value !== edited.jobId)
            clearResult(child);
          child.__zjEdited = edited;
          renderEdited(child, edited);
        }
      }
      const text = message?.text?.[0];
      if (typeof text === "string" && text.length <= 300) status(this, text);
    };
    const configured = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = configured?.apply(this, arguments);
      clearResult(this);
      return result;
    };
    const connections = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const result = connections?.apply(this, arguments);
      invalidate(this);
      return result;
    };
  },
});
