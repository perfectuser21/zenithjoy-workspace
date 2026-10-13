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
