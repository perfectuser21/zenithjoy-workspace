import { app } from '../../scripts/app.js';

app.registerExtension({
  name: 'ZenithJoy.PersistentRequestIds',
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (!['ZenithJoyImage2', 'ZenithJoyWan'].includes(nodeData.name)) return;
    const oldConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function() {
      const result = oldConfigure?.apply(this, arguments);
      const field = this.widgets?.find(w => w.name === 'request_id');
      if (field && !field.value) {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        field.value = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      }
      return result;
    };
    const oldClone = nodeType.prototype.clone;
    if (oldClone) nodeType.prototype.clone = function() {
      const cloned = oldClone.apply(this, arguments);
      const field = cloned?.widgets?.find(w => w.name === 'request_id');
      if (field) {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        field.value = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      }
      return cloned;
    };
    if (nodeData.name === 'ZenithJoyImage2') {
      const oldExecuted = nodeType.prototype.onExecuted;
      nodeType.prototype.onExecuted = function(message) {
        oldExecuted?.apply(this, arguments);
        const id = message?.text?.[0];
        if (!id) return;
        let field = this.widgets?.find(w => w.name === '素材任务ID（可复制）');
        if (!field) field = this.addWidget('text', '素材任务ID（可复制）', '', () => {}, { serialize: false });
        field.value = id;
        this.setDirtyCanvas(true, true);
      };
    }
    const oldCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      const result = oldCreated?.apply(this, arguments);
      const field = this.widgets?.find(w => w.name === 'request_id');
      const newId = () => {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        field.value = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
        this.setDirtyCanvas(true, true);
      };
      if (field) {
        if (!field.value) newId();
        this.addWidget('button', '生成新版本', null, newId, { serialize: false });
      }
      return result;
    };
  },
});
