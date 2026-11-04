import {test} from 'node:test';import assert from 'node:assert/strict';import {verifyReport} from './media-contracts.mjs';
const passed=()=>({success:true,numTotalTests:1,numPassedTests:1,numPendingTests:0,numTodoTests:0,numFailedTestSuites:0,testResults:[{name:'/repo/current.test.ts',status:'passed',assertionResults:[{status:'passed'}]}]});
test('accepts only an executed current suite',()=>assert.doesNotThrow(()=>verifyReport(passed(),['current.test.ts'])));
for(const [name,mutate] of [
 ['empty collection',r=>{r.numTotalTests=0;r.numPassedTests=0;}],['skipped test',r=>{r.numPendingTests=1;}],['todo test',r=>{r.numTodoTests=1;}],['import failure',r=>{r.success=false;r.numFailedTestSuites=1;}],['missing requested file',r=>{r.testResults=[];}],['empty requested suite',r=>{r.testResults[0].assertionResults=[];}],['skipped assertion',r=>{r.testResults[0].assertionResults[0].status='pending';}],
])test(`rejects ${name}`,()=>{const report=passed();mutate(report);assert.throws(()=>verifyReport(report,['current.test.ts']));});
