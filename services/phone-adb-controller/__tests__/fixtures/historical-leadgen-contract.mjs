import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {parse,stringify} from 'yaml';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';

// Historical script consumers retain their original contract/step regression
// inputs. These Git bytes are test fixtures, never current runtime fallbacks.
export const HISTORICAL_LEADGEN_REVISION='c3de2aca5e4dc8a7846863f55510005f1e57f57e';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const flows='douyin_(?:video_discovery|video_processing|comment_scoring|lead_outreach)';
const contract=new RegExp('^product-map/contracts/'+flows+'\\.yaml$');
const step=new RegExp('^services/phone-adb-controller/plans/'+flows+'\\.steps\\.json$');
const archive=readFileSync(new URL('./historical-leadgen-c3de.json.gz',import.meta.url));
const provenance=JSON.parse(readFileSync(new URL('./historical-leadgen-c3de.provenance.json',import.meta.url)));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
if(provenance.revision!==HISTORICAL_LEADGEN_REVISION||hash(archive)!==provenance.archive_sha256)throw Error('HISTORICAL_FIXTURE_SOURCE');
const originals=JSON.parse(gunzipSync(archive));
export function historicalLeadgenText(path){
 if(!contract.test(path)&&!step.test(path)&&!/^services\/phone-adb-controller\/skills\/douyin-leadgen-activity-103-(scoring|mark-leads)\/SKILL\.md$/.test(path))throw Error('HISTORICAL_FIXTURE_PATH');
 const text=originals[path];
 if(typeof text!=='string'||hash(text)!==provenance.files[path]?.sha256)throw Error('HISTORICAL_FIXTURE_DIGEST');
 return text;
}
export const historicalSteps=flow=>JSON.parse(historicalLeadgenText('services/phone-adb-controller/plans/'+flow+'.steps.json'));
export const historicalContract=flow=>historicalLeadgenText('product-map/contracts/'+flow+'.yaml');
export function historicalMethodsRead(path){
 if(!contract.test(path))return readFileSync(join(root,path));
 const historical=parse(historicalLeadgenText(path)),document=parse(readFileSync(join(root,path),'utf8'));
 // Exercise the exact historical code-binding set with the current method
 // metadata. This isolated mutation fixture does not combine two runtime sources.
 delete document.runtime;
 for(const activity of document.activities.filter(a=>!a.ref)){
  const original=historical.activities.find(a=>a.key===activity.key);
  activity.implementation_bindings=[...activity.implementation_bindings.filter(b=>b.kind==='skill'&&!b.purpose),...original.implementation_bindings.filter(b=>b.kind==='code'&&!b.purpose)];
 }
 return Buffer.from(stringify(document));
}
