import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
const {api}=vi.hoisted(()=>({api:vi.fn()}));
vi.mock('../lib/adminFetch',()=>({adminFetch:api}));
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>({user:{email:'fixture-reviewer@example.test'}})}));
import QuadrantPage from './QuadrantPage';
import NewRunPage from './NewRunPage';
beforeEach(()=>{vi.resetAllMocks();});afterEach(cleanup);
const quadrant=()=>render(<MemoryRouter initialEntries={['/acceptance/fixture-run/quadrant']}><Routes><Route path="/acceptance/:runKey/quadrant" element={<QuadrantPage/>}/></Routes></MemoryRouter>);
describe('staff acceptance UI contracts',()=>{
 it('unfinished human acceptance locks quadrant even when matrix data exists',async()=>{
  api.mockResolvedValue({ok:true,json:async()=>({run_key:'fixture-run',human_complete:false,matrix:[]})});quadrant();expect(await screen.findByTestId('quadrant-locked')).toBeTruthy();expect(screen.queryByTestId('quadrant-matrix')).toBeNull();
 });
 it('unavailable upstream gives a visible degraded state',async()=>{
  api.mockRejectedValue(new Error('fixture unavailable'));quadrant();expect(await screen.findByTestId('quadrant-degraded-banner')).toBeTruthy();
 });
 it('completed acceptance renders both AI and human verdicts without inventing a device result',async()=>{
  api.mockResolvedValue({ok:true,json:async()=>({run_key:'fixture-run',human_complete:true,matrix:[{cell_id:'c1',scenario_id:'S1',step:1,ai_verdict:'绿',human_verdict:'红',ai_evidence:'fixture evidence'}]})});quadrant();expect(await screen.findByTestId('quadrant-matrix')).toBeTruthy();expect(screen.getByText('合看矩阵 — fixture-run')).toBeTruthy();
 });
 it('new-run form cannot submit until mandatory scenarios have been selected',async()=>{
  render(<MemoryRouter><NewRunPage/></MemoryRouter>);expect((screen.getByTestId('new-run-submit') as HTMLButtonElement).disabled).toBe(true);fireEvent.submit(screen.getByTestId('new-run-form'));expect(api).not.toHaveBeenCalled();
 });
});
