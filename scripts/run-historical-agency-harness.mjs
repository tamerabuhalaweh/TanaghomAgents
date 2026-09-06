// Compatibility wrapper, not a new model-quality freeze. The historical source
// files remain byte-for-byte frozen. An ephemeral sibling changes only migration
// enumeration to the reviewed 0034 boundary; workspace tests separately apply0035.
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const names={integration:'agency-pilot-integration.mjs',quality:'agency-quality-runner.mjs'};
const name=names[process.argv[2]];assert.ok(name,'choose integration or quality');
const source=await readFile(new URL(name,import.meta.url),'utf8');
const needle=".filter(f=>f.endsWith('.up.sql')).sort()";
assert.equal(source.split(needle).length,2,'expected one historical migration enumerator');
const target=new URL(`.tmp-agency-harness-${randomUUID()}.mjs`,import.meta.url);
try{
 await writeFile(target,source.replace(needle,".filter(f=>f.endsWith('.up.sql')&&f<'0035').sort()"),{flag:'wx'});
 console.log(`Historical ${name}: explicit 0034 fixture; 0035 covered by test:agency-workspace`);
 const child=spawn(process.execPath,[fileURLToPath(target)],{stdio:'inherit',env:process.env});
 child.on('error',e=>{throw e;});const [code]=await once(child,'exit');process.exitCode=code??1;
}finally{await unlink(target);}
