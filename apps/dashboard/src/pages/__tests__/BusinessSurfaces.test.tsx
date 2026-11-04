import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const { auth, machines, stats, adminFetch, fetchFixture }=vi.hoisted(()=>({auth:vi.fn(),machines:vi.fn(),stats:vi.fn(),adminFetch:vi.fn(),fetchFixture:vi.fn()}));
vi.mock('../../contexts/AuthContext',()=>({useAuth:auth}));
vi.mock('../../api/wechat-cs-config.api',()=>({listCSMachines:machines}));
vi.mock('../../api/wechat-cs-stats.api',()=>({wechatCsStatsApi:{getStats:stats}}));
vi.mock('../../lib/admin-fetch',()=>({adminFetch}));
vi.mock('../../components/ListenerHealthSection',()=>({default:()=>null}));
// Child editors have their own contracts. These witnesses verify context passed by the real workbench.
vi.mock('../WechatCustomerServiceConfigPage',()=>({default:(p:any)=><div data-testid="editor">{JSON.stringify(p)}</div>}));
vi.mock('../CsOneClickSetupPage',()=>({default:(p:any)=><div data-testid="setup">{JSON.stringify(p)}</div>}));
vi.mock('../CustomerListPage',()=>({default:(p:any)=><div data-testid="customers">{JSON.stringify(p)}</div>}));
vi.mock('../CsWorkStatsPage',()=>({default:(p:any)=><div data-testid="stats">{JSON.stringify(p)}</div>}));
import CsAccountWorkbenchPage from '../CsAccountWorkbenchPage';
import CsAreaEntryPage from '../CsAreaEntryPage';
import AdminPlatformSessionsPage from '../AdminPlatformSessionsPage';
import AdminPublishLogsPage from '../AdminPublishLogsPage';
import OperatorPage from '../OperatorPage';
const machine={machine_id:'machine-fixture',wechat_id:'cs-fixture',self_name:'Fixture CS',online:true,found_window:true,auto_agent_enabled:false};
function page(element:React.ReactNode,initial='/'){
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[initial]}>{element}</MemoryRouter></QueryClientProvider>);
}
beforeEach(()=>{vi.clearAllMocks();auth.mockReturnValue({isSuperAdmin:false,user:{email:'fixture@example.test'},authLoading:false});machines.mockResolvedValue([machine]);stats.mockResolvedValue([{cs_wechat_id:'cs-fixture',served_customers:7}]);vi.stubGlobal('fetch',fetchFixture);fetchFixture.mockImplementation(async(url:string)=>({ok:true,json:async()=>url.includes('/agent-id')?{agent_id:'local-fixture'}:[]}));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.useRealTimers();});
describe('current business UI behavior',()=>{
 it('workbench denies unknown machine URLs even when another account exists',async()=>{
  page(<Routes><Route path="/wechat/account/:machineId" element={<CsAccountWorkbenchPage/>}/></Routes>,'/wechat/account/foreign');
  expect(await screen.findByTestId('cs-workbench-forbidden')).toBeInTheDocument();expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
 });
 it('workbench passes one CS context through all tabs and renders scoped stats',async()=>{
  page(<Routes><Route path="/wechat/account/:machineId" element={<CsAccountWorkbenchPage/>}/></Routes>,'/wechat/account/machine-fixture');
  expect(await screen.findByTestId('cs-workbench-title')).toHaveTextContent('Fixture CS');await waitFor(()=>expect(screen.getByText('今日接待 7 人')).toBeInTheDocument());
  for(const [tab,target] of [['kb','editor'],['settings','setup'],['customers','customers'],['stats','stats']]){fireEvent.click(screen.getByTestId(`cs-tab-${tab}`));expect(screen.getByTestId(target)).toHaveTextContent(tab==='settings'?'machine-fixture':'cs-fixture');}
 });
 it('single-account operators enter their exact workbench route',async()=>{
  page(<Routes><Route path="/" element={<CsAreaEntryPage/>}/><Route path="/wechat/account/:machineId" element={<div>scoped workbench destination</div>}/></Routes>);
  expect(await screen.findByText('scoped workbench destination')).toBeInTheDocument();
 });
 it('both admin pages refuse non-admin identities without fetching protected data',()=>{
  const first=page(<AdminPlatformSessionsPage/>);expect(screen.getByText(/403/)).toBeInTheDocument();first.unmount();
  page(<AdminPublishLogsPage/>);expect(screen.getByText(/403/)).toBeInTheDocument();expect(adminFetch).not.toHaveBeenCalled();
 });
 it('admin session table renders actual API fields and status for the requested endpoint',async()=>{
  auth.mockReturnValue({isSuperAdmin:true,user:{email:'fixture-admin@example.test'}});adminFetch.mockResolvedValue({ok:true,json:async()=>({success:true,total:1,data:[{session_id:'fixture-session',platform:'douyin',status:'active',expires_at:null}]})});
  page(<AdminPlatformSessionsPage/>);expect(await screen.findByTestId('platform-sessions-table-row')).toHaveTextContent('fixture-session');expect(screen.getByTestId('session-status')).toHaveTextContent('active');expect(adminFetch).toHaveBeenCalledWith('/api/admin/customers/platform-sessions','fixture-admin@example.test');
 });
 it('admin publish log page sends the selected tenant and renders returned work/status fields',async()=>{
  auth.mockReturnValue({isSuperAdmin:true,user:{email:'fixture-admin@example.test'}});adminFetch.mockResolvedValue({ok:true,json:async()=>({success:true,total:1,data:[{log_id:'fixture-log',work_id:'fixture-work',platform:'douyin',status:'success',created_at:'2026-11-04T00:00:00Z'}]})});
  page(<AdminPublishLogsPage/>,'/?tenant_id=fixture-tenant');expect(await screen.findByTestId('publish-logs-table-row')).toHaveTextContent('fixture-work');expect(screen.getByTestId('publish-logs-table-row')).toHaveTextContent('success');expect(adminFetch).toHaveBeenCalledWith('/api/admin/customers/publish-logs?tenant_id=fixture-tenant','fixture-admin@example.test');
 });
 it('operator binding targets discovered local agent and refreshes browser sessions',async()=>{
  auth.mockReturnValue({user:{email:'xuxiao21xx@icloud.com'},authLoading:false});page(<OperatorPage/>);
  await screen.findByText(/本机 Agent 已就绪/);expect(screen.getAllByRole('button',{name:'登录'})).toHaveLength(8);
  fireEvent.click(screen.getAllByRole('button',{name:'登录'})[0]);
  await waitFor(()=>expect(fetchFixture).toHaveBeenCalledWith('/api/operator/sessions/trigger-bind',expect.objectContaining({method:'POST',body:JSON.stringify({platform:'douyin',agent_id:'local-fixture'})})));
  expect(fetchFixture.mock.calls.filter(([url])=>url==='/api/operator/sessions').length).toBeGreaterThanOrEqual(2);
 });
});
