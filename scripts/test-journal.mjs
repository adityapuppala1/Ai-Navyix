/** Explicit local tests only. Missing source files fail instead of producing a zero-test success. */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const args=process.argv.slice(2);
if(args.length>1||(args.length===1&&args[0]!=='--integration')){
  console.error('Usage: node scripts/test-journal.mjs [--integration]');process.exitCode=1;
}else{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const files=['packages/server/test/journal.test.mjs','packages/server/test/journal-http.test.mjs',
    'packages/server/test/journal-repository.test.mjs','packages/server/test/journal-live.test.mjs',
    'packages/browser-session/test/journal-client.test.mjs','packages/browser-session/test/journal-proxy.test.mjs'];
  const missing=files.filter(file=>!existsSync(resolve(root,file)));
  if(missing.length){console.error('Missing required journal tests: '+missing.join(', '));process.exitCode=1;}
  else{
    const result=spawnSync(process.execPath,['--test',...files],{cwd:root,stdio:'inherit',shell:false,timeout:300000,
      env:{...process.env,...(args[0]==='--integration'?{NAVYIX_REQUIRE_INTEGRATION:'1'}:{})}});
    process.exitCode=result.error?1:result.status??1;
  }
}
