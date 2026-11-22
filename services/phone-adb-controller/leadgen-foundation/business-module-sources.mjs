// Fixed changed business modules execute from the host; unchanged dependencies retain admitted Phone provenance.
import fs from'node:fs';import path from'node:path';import{fileURLToPath,pathToFileURL}from'node:url';
const HERE=path.dirname(fileURLToPath(import.meta.url));
export const BUSINESS_MODULES=['leadgen-queue.js','discovery-metrics-queue.js','leadgen-committed-partial.js','judge-comment.js','leadgen-score-context.js'];
const AGENT_SCORE_MODULES=['leadgen-agent-score.js','leadgen-policy-review.js','leadgen-score-exclusion.js','judge-recipient.js','leadgen-outreach-bridge.js'];
const OUTREACH_SCORE_MODULES=['leadgen-policy-review.js','leadgen-score-context.js','leadgen-frozen-policy-evidence.js'];
export function businessModuleSources(context){
 const modules=context.assigned_workflow==='104'?OUTREACH_SCORE_MODULES
  :context.assigned_workflow==='103'?[...BUSINESS_MODULES,...AGENT_SCORE_MODULES]:BUSINESS_MODULES;
 const files={'business-runtime/package.json':'{"type":"commonjs"}\n'};
 for(const name of modules){
  let source=fs.readFileSync(path.join(HERE,'..',name),'utf8');
  source=source.replace(/require\((['"])(\.\/[^'"]+)\1\)/g,(all,_quote,relative)=>modules.includes(relative.slice(2))?all:'require('+JSON.stringify(path.join(context.runtime_root,relative))+')');
  source=source.replace(/import\((['"])(\.\/[^'"]+)\1\)/g,(all,_quote,relative)=>modules.includes(relative.slice(2))?all:'import('+JSON.stringify(pathToFileURL(path.join(context.runtime_root,relative)).href)+')');
  files['business-runtime/'+name]=source;
 }
 return files;
}
