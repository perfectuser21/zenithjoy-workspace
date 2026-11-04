import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runVideoProcess} from '../video-pipeline';
let directory='';afterEach(()=>{if(directory)rmSync(directory,{recursive:true,force:true});});
it('actual child process round-trips shell metacharacters as literal argv with no extra command',async()=>{
 directory=mkdtempSync(join(tmpdir(),'video-argv-security-'));
 const args=['quotes " and backslash \\', '$(touch PWNED)', '& echo injected', '%PATH%!EXPAND!', 'Unicode 路径 with spaces'];
 const result=await runVideoProcess(process.execPath,['-e','process.stdout.write(JSON.stringify(process.argv.slice(1)))',...args],{cwd:directory});
 expect(JSON.parse(result.stdout)).toEqual(args);expect(existsSync(join(directory,'PWNED'))).toBe(false);
});
it('real nonzero exit, timeout and bounded output cannot report process success',async()=>{
 await expect(runVideoProcess(process.execPath,['-e','process.stderr.write("fixture failure");process.exit(23)'])).rejects.toThrow(/23.*fixture failure/);
 await expect(runVideoProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:50})).rejects.toThrow(/timed out/);
 await expect(runVideoProcess(process.execPath,['-e','process.stdout.write("x".repeat(10000))'],{maxBuffer:32})).rejects.toThrow(/maxBuffer/);
});
