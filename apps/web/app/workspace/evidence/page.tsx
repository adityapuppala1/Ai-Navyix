import { createElement } from 'react';
import Script from 'next/script';
import Link from 'next/link';
export const dynamic = 'force-dynamic';
export default function GitHubEvidencePage() {
  if (process.env.NAVYIX_BROWSER_ENABLED !== 'true' || process.env.NAVYIX_GITHUB_ENABLED !== 'true')
    return <main style={{ padding: 32 }}><h1>GitHub evidence is not enabled</h1><p>The authenticated backend, an approved project connection, and the acceptance checks are required.</p><Link href="/workspace">Return to workspace</Link></main>;
  return <>{createElement('navyix-evidence-workbench')}<Script src="/workbench/evidence.mjs" type="module" strategy="afterInteractive" /><noscript>This inspector requires JavaScript. No project evidence is embedded in this page.</noscript></>;
}
