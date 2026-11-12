import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.join(root, 'apps/web/public/workbench');
await mkdir(destination, { recursive: true });
for (const name of ['index.html', 'app.mjs', 'workbench.css', 'connected.mjs', 'connected.css', 'team.mjs', 'team.css', 'evidence.mjs', 'evidence.css', 'journal.mjs', 'journal.css']) await copyFile(path.join(root, 'apps/web/workbench', name), path.join(destination, name));
for (const name of ['workflow.mjs', 'storage.mjs']) await copyFile(path.join(root, 'packages/workflow/src', name), path.join(destination, name));
// Only the browser-safe adapter is public. Never copy session, crypto, OIDC or database modules.
await copyFile(path.join(root, 'packages/browser-session/src/client.mjs'), path.join(destination, 'client.mjs'));
await copyFile(path.join(root, 'packages/browser-session/src/team-client.mjs'), path.join(destination, 'team-client.mjs'));
await copyFile(path.join(root, 'packages/browser-session/src/evidence-client.mjs'), path.join(destination, 'evidence-client.mjs'));
await copyFile(path.join(root, 'packages/browser-session/src/journal-client.mjs'), path.join(destination, 'journal-client.mjs'));
await copyFile(path.join(root, 'apps/web/workbench/organization-picker.mjs'), path.join(destination, 'organization-picker.mjs'));
await copyFile(path.join(root, 'packages/browser-session/src/organization-client.mjs'), path.join(destination, 'organization-client.mjs'));
console.log('Navyix workbench assets synchronized from canonical source.');
