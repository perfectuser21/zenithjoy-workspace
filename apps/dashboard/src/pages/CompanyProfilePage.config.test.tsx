import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CompanyProfilePage from './CompanyProfilePage';
const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('../api/company-profile.api', () => ({ getCompanyProfile: mocks.get, updateCompanyProfile: mocks.put }));
const data = { company_id:'company-a', company_name:'甲公司', city:'西安', industry:'教育', description:'', products:[], key_advantages:[], customer_problem:'', customer_portrait:'', qa_list:[], wiki:{markdown:'# 甲资料\n<script>危险</script>'}, runtime_config:{language:'zh-CN'}, config_version:2, config_status:'draft', config_owner:'负责人', source_evidence:[{source:'飞书主档案'}], sync_status:{notion:{status:'unmapped'},feishu:{status:'source_retained'}} };
beforeEach(()=>{ vi.clearAllMocks(); mocks.get.mockResolvedValue(data); mocks.put.mockResolvedValue({ config_version:3, profile:{...data, config_version:3} }); });
describe('公司Wiki页面',()=>{
 it('显示本公司版本来源与未接通映射，Wiki仅纯文本',async()=>{ render(<CompanyProfilePage/>); expect(await screen.findByText(/版本 2/)).toBeTruthy(); fireEvent.click(screen.getByRole('tab',{name:'公司Wiki与配置'})); expect(screen.getByLabelText('公司Wiki Markdown')).toHaveValue(data.wiki.markdown); expect(screen.getByText(/飞书主档案/)).toBeTruthy(); expect(screen.getByText(/Notion：未接通/)).toBeTruthy(); expect(document.querySelector('script')).toBeNull(); });
 it('非法JSON不能写入；保存成功采用新版本避免旧版本覆盖',async()=>{ render(<CompanyProfilePage/>); await screen.findByDisplayValue('甲公司'); fireEvent.click(screen.getByRole('tab',{name:'公司Wiki与配置'})); fireEvent.change(screen.getByLabelText('运行配置 JSON'),{target:{value:'{broken'}}); fireEvent.click(screen.getByRole('button',{name:'保存配置'})); expect(await screen.findByText(/JSON 格式错误/)).toBeTruthy(); expect(mocks.put).not.toHaveBeenCalled(); fireEvent.change(screen.getByLabelText('运行配置 JSON'),{target:{value:'{"language":"zh-CN"}'}}); fireEvent.click(screen.getByRole('button',{name:'保存配置'})); await waitFor(()=>expect(mocks.put).toHaveBeenCalled()); expect(await screen.findByText(/版本 3/)).toBeTruthy(); });
 it('加载错误明确显示，不让用户编辑空白假配置',async()=>{ mocks.get.mockRejectedValue(new Error('租户未关联公司')); render(<CompanyProfilePage/>); expect(await screen.findByRole('alert')).toHaveTextContent('租户未关联公司'); });
});

// Read the rendered cascade instead of asserting a chosen background token.
// Transparent containers expose the nearest painted ancestor; RGBA layers are
// composited so replacing a solid card with a translucent one cannot pass.
type Rgba = [number, number, number, number];
function rgba(css: string): Rgba | null {
 const values = css.match(/^rgba?\(([^)]+)\)$/)?.[1].split(',').map(Number);
 if (!values || values.length < 3 || values.some(v => !Number.isFinite(v))) return null;
 return [values[0], values[1], values[2], values[3] ?? 1];
}
function composite(front: Rgba, back: Rgba): Rgba {
 const alpha = front[3] + back[3] * (1 - front[3]);
 return [0,1,2].map(i => (front[i] * front[3] + back[i] * back[3] * (1 - front[3])) / alpha).concat(alpha) as Rgba;
}
function paintedBackground(element: HTMLElement): Rgba {
 const layers: Rgba[] = [];
 for (let node: HTMLElement | null = element; node; node = node.parentElement) {
  const layer = rgba(getComputedStyle(node).backgroundColor);
  if (layer) layers.push(layer);
 }
 return layers.reverse().reduce((back, front) => composite(front, back), [255,255,255,1] as Rgba);
}
function renderedForeground(element: HTMLElement): Rgba {
 for (let node: HTMLElement | null = element; node; node = node.parentElement) {
  const value = rgba(getComputedStyle(node).color);
  if (value) return value;
 }
 throw new Error('测试容器必须提供可解析的真实前景颜色');
}
function luminance(color: Rgba) {
 return color.slice(0,3).map(c => c / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4).reduce((sum,c,i) => sum + c * [0.2126,0.7152,0.0722][i],0);
}
function expectReadable(element: HTMLElement) {
 const background = paintedBackground(element);
 const foreground = composite(renderedForeground(element), background);
 const [lighter,darker] = [luminance(background),luminance(foreground)].sort((a,b) => b-a);
 const ratio = (lighter + 0.05) / (darker + 0.05);
 expect.soft(ratio, `${element.textContent?.slice(0,50)} 的正文对比度应≥4.5，实际${ratio.toFixed(2)}（前景${foreground.slice(0,3)}／背景${background.slice(0,3)}）`).toBeGreaterThanOrEqual(4.5);
}
function renderOnDarkShell() {
 // Matches the dark slate shell and the browser's default black body text.
 return render(<div style={{ backgroundColor:'#0f172a', color:'#000000' }}><div><CompanyProfilePage/></div></div>);
}
describe('公司Wiki在深色父背景中的可读性',()=>{
 it('正文、字段标签、Wiki与来源文字均有实际可读对比度',async()=>{
  renderOnDarkShell(); await screen.findByDisplayValue('甲公司');
  const basic = [screen.getByRole('heading',{name:/公司信息与Wiki/}),screen.getByText(/版本 2/),screen.getByText('公司名 *'),screen.getByTestId('company_name')];
  for(const element of basic)expectReadable(element);
  fireEvent.click(screen.getByRole('tab',{name:'公司Wiki与配置'}));
  const wiki = [screen.getByLabelText('公司Wiki Markdown').parentElement!,screen.getByLabelText('公司Wiki Markdown'),screen.getByText(/确认后才可启用/),screen.getByText('Notion：未接通'),screen.getByTestId('company-source-evidence')];
  for(const element of wiki)expectReadable(element);
 });
 it('加载提示在深色父背景中可读',()=>{
  mocks.get.mockImplementationOnce(()=>new Promise(()=>{}));renderOnDarkShell();expectReadable(screen.getByText('正在读取公司资料...'));
 });
 it('读取失败提示及重试操作在深色父背景中可读',async()=>{
  mocks.get.mockRejectedValueOnce(new Error('租户未关联公司'));renderOnDarkShell();expectReadable(await screen.findByRole('alert'));expectReadable(screen.getByRole('button',{name:'重新读取公司资料'}));
 });
});
