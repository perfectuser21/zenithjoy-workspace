// DoD B-03 oracle：素材 storage_key 能签出非空预览 URL（前端 <video> 数据源）。
// 从仓库根运行：node <this>
const { createMaterialStorage } = require('../../../../apps/api/dist/services/material-storage.js');

(async () => {
  const s = createMaterialStorage();
  const u = await s.getSignedUrl('some/tenant/key.mp4');
  if (!u || typeof u !== 'string' || u.length === 0) throw new Error('签名 URL 为空');
  console.log('OK B-03 signed url prefix=' + String(u).slice(0, 8));
})()
  .then(() => process.exit(0))
  .catch((e) => { console.error('FAIL ' + e.message); process.exit(1); });
