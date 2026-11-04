import { app } from '../../scripts/app.js';

// This runs in the authenticated, same-origin browser. Instance service tokens
// stay on the server; uploads use the employee's existing session cookie.
app.registerExtension({
  name: 'ZenithJoy.WanRemakeUploads',
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== 'ZenithJoyWanRemake') return;
    const previousCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      const result = previousCreated?.apply(this, arguments);
      const node = this;
      let uploading = false;
      let removed = false;
      const oldRemoved = node.onRemoved;
      node.onRemoved = function() { removed = true; return oldRemoved?.apply(this, arguments); };
      const field = name => node.widgets?.find(widget => widget.name === name);
      const status = node.addWidget('text', '素材上传状态', '请先上传参考视频；按需上传产品、背景或人脸图片', () => {}, { serialize: false });
      const show = message => { if (!removed) { status.value = message; node.setDirtyCanvas(true, true); } };
      for (const [label, name, kind] of [
        ['上传参考视频', '参考视频ID', 'video'], ['上传产品或Logo图片', '产品图片ID', 'image'],
        ['上传背景图片', '背景图片ID', 'image'], ['上传人脸图片', '人脸图片ID', 'image'],
      ]) {
        node.addWidget('button', label, null, () => {
          if (uploading || removed) { show('素材上传中，请等待完成后继续'); return; }
          const input = document.createElement('input');
          input.type = 'file'; input.accept = kind === 'video' ? '.mp4,.mov' : '.png,.jpg,.jpeg,.webp';
          input.onchange = async () => {
            const file = input.files?.[0];
            if (!file || removed || uploading) return;
            const valid = kind === 'video' ? /\.(mp4|mov)$/i.test(file.name) : /\.(png|jpe?g|webp)$/i.test(file.name);
            if (!valid || !file.size || file.size > (kind === 'video' ? 100 : 20) * 1024 * 1024) {
              show(kind === 'video' ? '请选择不超过 100 MB 的 MP4 或 MOV 视频' : '请选择不超过 20 MB 的 PNG、JPG 或 WebP 图片'); return;
            }
            const target = field(name);
            if (!target) return;
            const oldValue = target.value;
            uploading = true; target.value = '上传中'; show(`正在上传 ${file.name}，请等待完成后再运行`);
            try {
              const data = new FormData(); data.append('file', file);
              const response = await fetch('/api/video-tools/uploads', {method:'POST',credentials:'include',body:data});
              if (!response.ok) throw new Error(`上传失败（HTTP ${response.status}），请检查登录状态、文件大小或稍后重试`);
              const asset = await response.json();
              if (asset.kind !== kind || typeof asset.id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(asset.id)) {
                throw new Error(kind === 'video' ? '上传结果不是有效视频，请重新选择视频' : '上传结果不是有效图片，请重新选择图片');
              }
              if (!removed) { target.value = asset.id; show(`${file.name} 上传完成。修改已提交的参数后，请点击“生成新版本”再运行。`); }
            } catch (error) {
              if (!removed) { target.value = oldValue; show(error instanceof Error ? error.message : '上传连接失败，请稍后重试'); }
            } finally { uploading = false; input.remove(); }
          };
          input.click();
        }, { serialize: false });
      }
      const previousExecuted = node.onExecuted;
      node.onExecuted = function(message) {
        previousExecuted?.apply(this, arguments);
        const id = message?.text?.[0];
        if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) return;
        let widget = field('视频任务ID（可复制）');
        if (!widget) widget = node.addWidget('text', '视频任务ID（可复制）', '', () => {}, {serialize:false});
        widget.value = id; node.setDirtyCanvas(true, true);
      };
      return result;
    };
  },
});
