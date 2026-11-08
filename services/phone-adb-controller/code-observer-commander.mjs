// Code仍执行业务；观察者只读固定合同与回执，不加载共享Commander工作区。
import {join} from 'node:path';
import {createCodeObserverRequest} from './code-observer-authority.mjs';
import {createRunnerCodeActivityCommander} from './runner-official-commander.mjs';
export function createRunnerCodeCommander({runDir,source,frozen,binding,activities,context,env,createObserver}){
 if(!frozen.code_observer_scope||binding?.id!==context.binding_id||binding?.run_id!==context.run_id||frozen.code_observer_scope.task_id!==context.task_id||!/^a[1-9][0-9]*$/.test(env?.WFR_ATTEMPT??''))throw Error('CODE_OBSERVER_WORKFLOW_IDENTITY');
 const scope=frozen.code_observer_scope;
 return createRunnerCodeActivityCommander({runtimeRoot:join(runDir,'runtime'),runDir,source,activities,workflowDeadlineMs:(scope.run_start_ts+scope.run_max_seconds)*1000,prepareRequest:activity=>createCodeObserverRequest({runtimeRoot:join(runDir,'runtime'),source,activity,attempt:env.WFR_ATTEMPT}),...(createObserver?{createObserver}:{})});
}
