import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {attachQualificationReceipt} from '../../../qualification-handoff.mjs';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
export function evidenceFor(v,stage,identity) {
  const own=v[stage]||{};
  if(!v.proof_manifest_path)return own;
  const filename=path.resolve(v.proof_manifest_path);
  if(!path.isAbsolute(v.proof_manifest_path)||filename.startsWith(process.cwd()+'/'))throw Error('HOST_PROOF_MANIFEST_REQUIRED');
  const raw=fs.readFileSync(filename),manifest=JSON.parse(raw);
  if(manifest.schema!=='activity-evidence/v1'||!['task_id','run_id','run_tag','workflow'].every(k=>manifest.identity?.[k]===identity[k]))throw Error('PROOF_MANIFEST_SCOPE_MISMATCH');
  // Tool host can publish new raw proof references; cannot replace frozen input scope or policy.
  return {...own,filter_evidence:manifest.filter_evidence||own.filter_evidence,
          qualification_evidence:manifest.qualification_evidence||own.qualification_evidence,
          qualification_receipt_source:{path:filename,sha256:hash(raw)}};
}

export function finalize(request,result,proofManifest){const checks=new Map(result.checks.map(c=>[c.id,c]));
  result.checks=[...checks.values()];
  result.outcome=result.checks.length>0&&result.checks.every(x=>x.status==='passed')?((result.output.no_collectable_videos===true||result.output.queue_empty===true)?'empty':'passed'):'blocked';
  return attachQualificationReceipt(request,result,{proofManifest:proofManifest});
}
