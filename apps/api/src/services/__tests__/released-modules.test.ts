import {it,expect} from 'vitest';
import {selectReleasedModules} from '../released-modules';
const baseline={'line04-wechat-cs':{status:'active' as const,required_version:'1.0.153'}};
it('未晋级候选不影响心跳；正式manifest选择版本，恢复前驱后选择原版本',()=>{
 expect(selectReleasedModules(baseline,null)).toEqual(baseline);
 const upgraded={modules:[{line_id:'line04-wechat-cs',filename:'line04-wechat-cs-v1.0.154.tar.gz'}]};
 expect(selectReleasedModules(baseline,upgraded)['line04-wechat-cs'].required_version).toBe('1.0.154');
 expect(selectReleasedModules(baseline,null)['line04-wechat-cs'].required_version).toBe('1.0.153');
 expect(()=>selectReleasedModules(baseline,{modules:[]})).toThrow();
});
