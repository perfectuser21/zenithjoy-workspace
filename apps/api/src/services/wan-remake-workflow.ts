/** Selective Wan 3.0 video editing. Asset IDs, never client URLs, define each role. */
export interface RemakeConfig {
  referenceAssetId: string;
  productMode: 'keep' | 'replace' | 'color' | 'logo';
  productAssetId?: string;
  productDescription?: string;
  targetColor?: string;
  background: boolean;
  backgroundDescription?: string;
  backgroundAssetId?: string;
  face: boolean;
  facePresence: 'unknown' | 'absent' | 'present';
  faceAssetId?: string;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function invalid(message: string): never { throw Object.assign(new Error(message), { status: 400 }); }
function assetId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !uuid.test(value)) return invalid(`请先上传${label}`);
  return value.toLowerCase();
}
function description(value: unknown, label: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 1000) return invalid(`${label}不能超过 1000 字`);
  return value.trim() || undefined;
}

/** Normalize before hashing: inactive inputs must neither leak into prompts nor change retries. */
export function parseRemake(value: unknown): RemakeConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('复刻配置无效');
  const input = value as Record<string, unknown>;
  if (!['keep', 'replace', 'color', 'logo'].includes(String(input.productMode))) return invalid('请选择有效的产品替换模式');
  if (typeof input.background !== 'boolean' || typeof input.face !== 'boolean') return invalid('请选择是否更换背景和模特脸');
  const config: RemakeConfig = { referenceAssetId: assetId(input.referenceAssetId, '原视频'),
    productMode: input.productMode as RemakeConfig['productMode'], background: input.background, face: input.face,
    facePresence: 'unknown' };
  if (config.productMode !== 'keep') {
    if (config.productMode !== 'color' || input.productAssetId) config.productAssetId = assetId(input.productAssetId, config.productMode === 'logo' ? '目标 Logo 图片' : '本店产品图片');
    config.productDescription = description(input.productDescription, '产品说明');
    if (config.productMode === 'replace' && !config.productDescription) return invalid('请填写产品品类和外观说明，例如黑白厚手套');
    if (config.productMode === 'color') {
      config.targetColor = description(input.targetColor, '目标颜色');
      if (!config.targetColor) return invalid('请填写目标颜色');
    }
  }
  if (config.background) {
    config.backgroundDescription = description(input.backgroundDescription, '背景说明');
    if (input.backgroundAssetId) config.backgroundAssetId = assetId(input.backgroundAssetId, '目标背景图片');
    if (!config.backgroundAssetId && !config.backgroundDescription) return invalid('请填写目标背景或上传背景图片');
  }
  if (config.face) {
    if (!['absent', 'present'].includes(String(input.facePresence))) return invalid('请先确认原视频是否露脸');
    config.facePresence = input.facePresence as RemakeConfig['facePresence'];
    if (config.facePresence === 'present') config.faceAssetId = assetId(input.faceAssetId, '目标模特脸图片');
  }
  if (config.productMode === 'keep' && !config.background && !(config.face && config.facePresence === 'present')) {
    return invalid(config.face ? '原视频未露脸，本次没有可执行的替换项' : '请至少选择一项替换内容');
  }
  return config;
}

export function remakeAssets(config: RemakeConfig): Array<{ id: string; kind: 'image' | 'video' }> {
  return [{ id: config.referenceAssetId, kind: 'video' },
    ...[config.productAssetId, config.backgroundAssetId, config.faceAssetId]
      .filter((id): id is string => Boolean(id)).map(id => ({ id, kind: 'image' as const }))];
}

/** Image numbering follows Wan's per-media-type order, regardless of video position. */
export function compileRemake(config: RemakeConfig, urls: string[]) {
  const assets = remakeAssets(config);
  if (urls.length !== assets.length) throw new Error('Missing resolved remake asset');
  const lines = ['编辑视频1，执行下面明确选择的局部替换。原视频是待编辑原片，保留原镜头顺序、运镜、构图、动作轨迹、节奏和时长；不要重新编写分镜。'];
  let image = 0;
  if (config.productMode === 'keep') lines.push('产品的款式、颜色、Logo、材质、轮廓和细节全程保持原样。');
  else {
    const reference = config.productAssetId ? `图片${++image}` : '';
    const target = config.productDescription ? `（${config.productDescription}）` : '';
    if (config.productMode === 'replace') lines.push(`将视频1中展示的产品${target}替换为${reference}中的本店同品类产品。保持参考图的颜色、Logo、版型、材质和配件；只替换同品类产品，不跨品类替换。保持原有佩戴位置、手部动作、遮挡和握持关系。`);
    if (config.productMode === 'color') lines.push(`只修改视频1中的产品${target}颜色为${config.targetColor}${reference ? `，参考${reference}` : ''}；产品款式、Logo、版型、材质、配件和尺寸比例保持原样。`);
    if (config.productMode === 'logo') lines.push(`只替换视频1中产品${target}上的 Logo 为${reference}的目标 Logo；保留目标文字、字形和图案，贴合原产品表面的透视、遮挡和光照。产品款式、颜色、材质和尺寸比例保持原样。`);
  }
  if (config.background) {
    const reference = config.backgroundAssetId ? `图片${++image}` : '';
    lines.push(`只将环境背景替换为${reference}${config.backgroundDescription ? `（${config.backgroundDescription}）` : ''}，保持主体位置、动作、服装和产品细节；调整环境光照使主体自然融入。`);
  } else lines.push('背景保持原样，包括场景、环境、建筑和光线。');
  if (config.face && config.facePresence === 'present') {
    lines.push(`只将视频1中出镜模特的面部外观替换为图片${++image}中的目标面部，保持原人物的表情变化、头部姿态和视线；身体、发型、服装及产品保持原样。不要新增人物。`);
  } else lines.push(config.face ? '原视频未露脸，跳过换脸，不添加新的人脸或人物。' : '人物面部保持原样，不更换人物身份。');
  lines.push('除上面明确指定的内容外，其余画面保持不变。不新增人物、商品、字幕、价格或声音。产品及手部结构保持稳定，不变形、不闪烁。输出无音轨视频。');
  return { prompt: lines.join('\n'), media: assets.map((asset, index) => ({ type: asset.kind === 'video' ? 'reference_video' : 'reference_image', url: urls[index] })),
    duration: -1, ratio: 'adaptive', resolution: '720P', audio: false, promptExtend: false };
}
