/** Cross-platform explicit local tests. No shell globbing, migrations, installs or CI dispatch. */
import { fileURLToPath } from 'node:url';
import { options, supportedNode, executionEnvironment, discover, execute } from './lib/test-workspace.mjs';
try {
  if (!supportedNode()) throw new Error('Node.js 22.16 or newer is required for reliable test summaries.');
  const settings = options(process.argv.slice(2));
  const plan = discover(fileURLToPath(new URL('../', import.meta.url)), settings.groups);
  if (settings.list) {
    console.log(JSON.stringify({ inventory: plan.inventory, groups: plan.groups, files: plan.files.map(file => file.slice(plan.root.length + 1)) }, null, 2));
  } else {
    const env = executionEnvironment(process.env, settings.integration);
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    console.log(`Navyix: ${plan.files.length} files; ${plan.groups.join(', ')}; ${settings.integration ? 'explicit disposable integration' : 'database integration disabled'}.`);
    const report = await execute(plan, { integration: settings.integration, output: line => process.stderr.write(String(line) + '\n') });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.status === 'failed' ? 1 : 0;
  }
} catch (error) {
  console.error(`Navyix test preflight blocked: ${error.message}`);
  process.exitCode = 2;
}
