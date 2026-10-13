import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkbenchTablePage from './WorkbenchTablePage';
import { getTable, listRows, listRowsWith, listRowTrash, listViews, patchView, type WorkbenchView } from '../lib/workbenchFetch';

vi.mock('../lib/workbenchFetch', async importOriginal => ({ ...await importOriginal<typeof import('../lib/workbenchFetch')>(), getTable: vi.fn(), listRows: vi.fn(), listRowsWith: vi.fn(), listRowTrash: vi.fn(), listViews: vi.fn(), patchView: vi.fn() }));
vi.mock('../components/WorkbenchRowGrid', () => ({ default: () => null }));
vi.mock('../components/WorkbenchKanbanView', () => ({ default: () => null }));
vi.mock('../components/WorkbenchRowDetailPanel', () => ({ default: () => null }));
vi.mock('../components/WorkbenchRollupConfig', () => ({ default: () => null }));
const view: WorkbenchView = { view_id: 'view', name: 'Default', view_type: 'grid', filters: [], sorts: [], group_field_id: null, hidden_field_ids: [], is_active: true, degraded: false, updated_at: '2026-10-13T00:00:00Z' };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function open() {
 render(<MemoryRouter initialEntries={['/tables/table']}><Routes><Route path="/tables/:tableId" element={<WorkbenchTablePage />} /></Routes></MemoryRouter>);
 await screen.findByTestId('view-switcher');
}
async function filter() {
 fireEvent.change(screen.getByTestId('filter-field-select'), { target: { value: 'text' } });
 fireEvent.change(screen.getByTestId('filter-value-input'), { target: { value: '甲' } });
 fireEvent.click(screen.getByTestId('apply-query-button'));
 await waitFor(() => expect(patchView).toHaveBeenCalledTimes(1));
}
function TableNavigator() { const go = useNavigate(); return <button data-testid="go-other-table" onClick={() => go('/tables/other-table')}>Other table</button>; }
function openWithNavigation() {
 render(<MemoryRouter initialEntries={['/tables/table']}><TableNavigator /><Routes><Route path="/tables/:tableId" element={<WorkbenchTablePage />} /></Routes></MemoryRouter>);
}
function twoTables() {
 const other={...view,view_id:'other-view',name:'Other view'};
 vi.mocked(listViews).mockImplementation(async id => ({views:[id==='table'?{...view}:other],active_view_id:id==='table'?'view':'other-view'}));
}
beforeEach(() => {
 vi.clearAllMocks();
 vi.mocked(getTable).mockResolvedValue({ name: 'Table', fields: [{field_id:'text',name:'Text',field_type:'text'}, {field_id:'number',name:'Number',field_type:'number'}] } as Awaited<ReturnType<typeof getTable>>);
 vi.mocked(listRows).mockResolvedValue({ rows: [], total: 0, row_limit: 100 });
 vi.mocked(listRowsWith).mockResolvedValue({ rows: [], total: 0, row_limit: 100 });
 vi.mocked(listRowTrash).mockResolvedValue([]);
 vi.mocked(listViews).mockResolvedValue({ views: [{...view}], active_view_id:'view' });
});
afterEach(cleanup);
describe('view preferences save ordering', () => {
 it('preserves a later hidden-column choice while an earlier save response is pending, and saves both patches', async () => {
  const first=deferred<WorkbenchView>(), second=deferred<WorkbenchView>();
  vi.mocked(patchView).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await open(); await filter(); fireEvent.click(screen.getByTestId('hide-col-number'));
  expect(screen.getByTestId('hide-col-number')).toBeChecked();
  expect(patchView).toHaveBeenCalledTimes(1);
  await act(async () => first.resolve({...view, filters:[{field_id:'text',op:'contains',value:'甲'}]}));
  expect(screen.getByTestId('hide-col-number')).toBeChecked();
  await waitFor(() => expect(patchView).toHaveBeenCalledTimes(2));
  expect(vi.mocked(patchView).mock.calls[1]).toEqual(['view',{hidden_field_ids:['number']}]);
  await act(async () => second.resolve({...view, filters:[{field_id:'text',op:'contains',value:'甲'}],hidden_field_ids:['number']}));
  expect(screen.getByTestId('hide-col-number')).toBeChecked();
 });
 it('saves consecutive edits to the same field in order without rechecking a later unchecked choice', async () => {
  const first=deferred<WorkbenchView>(), second=deferred<WorkbenchView>();
  vi.mocked(patchView).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await open(); fireEvent.click(screen.getByTestId('hide-col-number'));
  await waitFor(() => expect(patchView).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByTestId('hide-col-number'));
  expect(screen.getByTestId('hide-col-number')).not.toBeChecked();
  expect(patchView).toHaveBeenCalledTimes(1);
  await act(async () => first.resolve({...view,hidden_field_ids:['number']}));
  expect(screen.getByTestId('hide-col-number')).not.toBeChecked();
  await waitFor(() => expect(patchView).toHaveBeenCalledTimes(2));
  expect(vi.mocked(patchView).mock.calls.map(call=>call[1])).toEqual([{hidden_field_ids:['number']},{hidden_field_ids:[]}]);
  await act(async () => second.resolve({...view}));
  expect(screen.getByTestId('hide-col-number')).not.toBeChecked();
 });
 it('preserves an unsaved choice across another view activation and retries that view after failure', async () => {
  const first=deferred<WorkbenchView>(); const other={...view,view_id:'other',name:'Other',is_active:false};
  vi.mocked(listViews).mockResolvedValue({views:[{...view},other],active_view_id:'view'});
  vi.mocked(patchView).mockImplementation(async (id,patch)=> id==='view' && patch.hidden_field_ids ? first.promise : {...(id==='other'?other:view),...patch});
  await open(); fireEvent.click(screen.getByTestId('hide-col-number'));
  await waitFor(()=>expect(patchView).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByTestId('view-tab-other'));
  await waitFor(()=>expect(listViews).toHaveBeenCalledTimes(2));
  await act(async()=>first.reject(new Error('offline')));
  fireEvent.click(screen.getByTestId('view-tab-view'));
  await waitFor(()=>expect(listViews).toHaveBeenCalledTimes(3));
  expect(screen.getByTestId('hide-col-number')).toBeChecked();
  expect(screen.getByTestId('view-prefs-error')).toHaveTextContent('视图偏好未保存');
  vi.mocked(patchView).mockResolvedValue({...view,hidden_field_ids:['number']});
  fireEvent.click(screen.getByTestId('view-prefs-retry'));
  await waitFor(()=>expect(screen.queryByTestId('view-prefs-error')).not.toBeInTheDocument());
  expect(vi.mocked(patchView).mock.calls.at(-1)).toEqual(['view',expect.objectContaining({hidden_field_ids:['number']})]);
 });
 it('does not erase an unsaved filter error when another field succeeds, and explicit retry saves the complete choice', async () => {
  const first=deferred<WorkbenchView>(), second=deferred<WorkbenchView>();
  vi.mocked(patchView).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValue({...view,filters:[{field_id:'text',op:'contains',value:'甲'}],hidden_field_ids:['number']});
  await open(); await filter(); fireEvent.click(screen.getByTestId('hide-col-number'));
  await act(async () => first.reject(new Error('offline')));
  await waitFor(() => expect(patchView).toHaveBeenCalledTimes(2));
  await act(async () => second.resolve({...view,hidden_field_ids:['number']}));
  expect(screen.getByTestId('view-prefs-error')).toHaveTextContent('视图偏好未保存');
  fireEvent.click(screen.getByTestId('view-prefs-retry'));
  await waitFor(() => expect(patchView).toHaveBeenCalledTimes(3));
  expect(vi.mocked(patchView).mock.calls[2][1]).toMatchObject({filters:[{field_id:'text',op:'contains',value:'甲'}],hidden_field_ids:['number']});
  await waitFor(() => expect(screen.queryByTestId('view-prefs-error')).not.toBeInTheDocument());
 });
 it('rejects an old activation response after navigation to another table', async () => {
  twoTables(); const activation=deferred<WorkbenchView>();vi.mocked(patchView).mockReturnValue(activation.promise);
  openWithNavigation();await screen.findByTestId('view-tab-view');fireEvent.click(screen.getByTestId('view-tab-view'));
  await waitFor(()=>expect(patchView).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByTestId('go-other-table'));await screen.findByTestId('view-tab-other-view');
  await act(async()=>activation.resolve({...view}));
  expect(screen.queryByTestId('view-tab-view')).not.toBeInTheDocument();
  expect(screen.getByTestId('view-tab-other-view')).toBeInTheDocument();
 });
 it('rejects old activation row refresh after the new table has loaded', async () => {
  twoTables(); const oldRows=deferred<Awaited<ReturnType<typeof listRows>>>();let reads=0;
  vi.mocked(patchView).mockResolvedValue({...view});
  vi.mocked(listRows).mockImplementation(async id => id==='table' && ++reads===2 ? oldRows.promise : {rows:[],total:0,row_limit:id==='table'?100:222});
  openWithNavigation();await screen.findByTestId('view-tab-view');fireEvent.click(screen.getByTestId('view-tab-view'));
  await waitFor(()=>expect(listRows).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByTestId('go-other-table'));await screen.findByTestId('view-tab-other-view');
  await waitFor(()=>expect(screen.getByTestId('row-limit-hint')).toHaveTextContent('222'));
  await act(async()=>oldRows.resolve({rows:[],total:0,row_limit:111}));
  expect(screen.getByTestId('row-limit-hint')).toHaveTextContent('222');
 });
 it('serializes activation of the same view after its pending preferences write', async () => {
  const pending=deferred<WorkbenchView>();vi.mocked(patchView).mockReturnValueOnce(pending.promise).mockResolvedValue({...view,hidden_field_ids:['number']});
  await open();fireEvent.click(screen.getByTestId('hide-col-number'));
  await waitFor(()=>expect(patchView).toHaveBeenCalledTimes(1));fireEvent.click(screen.getByTestId('view-tab-view'));
  expect(patchView).toHaveBeenCalledTimes(1);
  await act(async()=>pending.resolve({...view,hidden_field_ids:['number']}));
  await waitFor(()=>expect(patchView).toHaveBeenCalledTimes(2));
  expect(vi.mocked(patchView).mock.calls[1]).toEqual(['view',{is_active:true}]);
 });

});
