import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import request from 'supertest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
vi.mock('../../src/db/connection',()=>({default:{query:vi.fn(),end:vi.fn()}}));
let directory:string,app:typeof import('../../src/app').default;
const name=`fixture-${randomUUID()}.txt`,content=`unique screenshot fixture ${randomUUID()}`;
beforeAll(async()=>{
 directory=await mkdtemp(join(tmpdir(),'screenshots-contract-'));
 await writeFile(join(directory,name),content);await writeFile(join(directory,'.secret'),'must-not-be-served');
 vi.stubEnv('SCREENSHOTS_DIR',directory);app=(await import('../../src/app')).default;
});
afterAll(async()=>{vi.unstubAllEnvs();await rm(directory,{recursive:true,force:true});});
it('actual app serves exactly the bytes written in its own volume',async()=>{const r=await request(app).get(`/screenshots/${name}`);expect(r.status).toBe(200);expect(r.text).toBe(content);});
it('missing files, dotfiles and traversal cannot read outside the screenshot root',async()=>{
 for(const path of ['/screenshots/nonexistent-fixture.txt','/screenshots/.secret','/screenshots/%2e%2e/package.json'])expect((await request(app).get(path)).status).toBe(404);
});
