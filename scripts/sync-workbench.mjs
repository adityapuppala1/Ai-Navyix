import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.join(root, 'apps/web/public/workbench');
await mkdir(destination, { recursive: true });
for (const name of ['index.html', 'app.mjs', 'workbench.css', 'connected.mjs', 'connected.css']) await copyFile(path.join(root, 'apps/web/workbench', name), path.join(destination, name));
for (const name of ['workflow.mjs', 'storage.mjs']) await copyFile(path.join(root, 'packages/workflow/src', name), path.join(destination, name));
// Only the browser-safe adapter is public. Never copy session, crypto, OIDC or database modules.
await copyFile(path.join(root, 'packages/browser-session/src/client.mjs'), path.join(destination, 'client.mjs'));
console.log('Navyix workbench assets synchronized from canonical source.');
