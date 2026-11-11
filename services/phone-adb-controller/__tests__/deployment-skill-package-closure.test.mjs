import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,symlinkSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const deploy=readFileSync(join(root,'deploy.sh'),'utf8');
const prefix=deploy.slice(deploy.indexOf('MMV_JS_FILES=('),deploy.indexOf('# 在任何SSH前'));
function files(name){
 return execFileSync('/bin/bash',['-c',prefix+`\nprintf '%s\\0' "\${${name}[@]}"`],{encoding:'utf8'}).split('\0').filter(Boolean);
}
const roles=[
 {name:'MMV',files:()=>files('MMV_RUNTIME_FILES'),entries:['leadgen-handlers.mjs','leadgen-public-domain.mjs','official-child-host.mjs']},
 {name:'DEVICE',files:()=>['DEVICE_SH_FILES','DEVICE_NODE_FILES','DEVICE_RPC_PROBE_FILES','DEVICE_PLAN_FILES','DEVICE_CTL_FILES'].flatMap(files),entries:['leadgen-handlers.mjs','leadgen-public-domain.mjs','official-child-host.mjs']},
 {name:'RPC',files:()=>files('RPC_FILES'),entries:['official-child-primitives.mjs','official-child-host.mjs','activity-skill-primary-broker.mjs']},
];
const epochEntries=['device-epoch-fence-resume.mjs','device-epoch-fence-auth-reference.mjs','device-epoch-fence-resume-startup.mjs','device-epoch-fence-runtime.mjs'];
for(const role of roles)test(`real ${role.name} deployment package imports the Skill-first entries with its own closure`,t=>{
 const directory=realpathSync(mkdtempSync(join(tmpdir(),'skill-deploy-package-')));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const names=role.files();assert.equal(new Set(names).size,names.length,`${role.name} duplicate deployment paths are rejected by deploymentManifest`);
 for(const name of names){const target=join(directory,name);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(root,name),target);}
 // Parse the actual copied Python helper; never import it or invoke a service.
 // Its source_manifest requires more than the static Node import graph.
 const python=`import ast,json,sys\nt=ast.parse(open(sys.argv[1]).read());constants={}\ndef literal(n):\n if isinstance(n,ast.Constant) and isinstance(n.value,str):return n.value\n if isinstance(n,ast.Name):return constants[n.id]\n if isinstance(n,(ast.Tuple,ast.List)):return [literal(v) for v in n.elts]\n raise AssertionError('unexpected source inventory expression')\nfor n in t.body:\n if isinstance(n,ast.Assign) and any(isinstance(x,ast.Name) and x.id in ('REGISTRY','SOURCE_FILES') for x in n.targets):\n  for x in n.targets:\n   if isinstance(x,ast.Name):constants[x.id]=literal(n.value)\nf=next(n for n in t.body if isinstance(n,ast.FunctionDef) and n.name=='source_manifest')\nassert any(isinstance(n,ast.Name) and n.id=='SOURCE_FILES' for n in ast.walk(f))\nprint(json.dumps(constants['SOURCE_FILES']))\n`;
 const sourceFiles=JSON.parse(execFileSync('/usr/bin/python3',['-I','-S','-c',python,join(directory,'adb-host-instance-policy.py')],{env:{PATH:'/usr/bin:/bin',HOME:directory},encoding:'utf8',timeout:10000}));
 for(const name of sourceFiles)assert.ok(names.includes(name)&&existsSync(join(directory,name)),`${role.name} omits source_manifest dependency ${name}`);
 // Only third-party dependencies are shared; no controller source is supplied
 // outside the actual deploy arrays under test.
 symlinkSync(realpathSync(new URL('../../../node_modules',import.meta.url)),join(directory,'node_modules'),'dir');
 const imports=[...role.entries,...epochEntries].map(name=>pathToFileURL(join(directory,name)).href);
 const source=`for (const entry of ${JSON.stringify(imports)}) await import(entry);`;
 execFileSync(process.execPath,['--input-type=module','-e',source],{cwd:directory,env:{HOME:directory,PATH:process.env.PATH},stdio:'pipe',timeout:20000});
 for(const name of ['official-cli-quarantine.py','official-recording-observer.py','skills/leadgen-official-child-host.md','adb-private-auth.py','adb-private-supervisor.py'])assert.ok(names.includes(name)&&existsSync(join(directory,name)),`${role.name} omits fixed Skill support ${name}`);
});
