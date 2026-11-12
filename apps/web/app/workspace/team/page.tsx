import { createElement } from 'react';
import Link from 'next/link';
import Script from 'next/script';
export const dynamic = 'force-dynamic';
export default function TeamPage() {
  const enabled = process.env.NAVYIX_BROWSER_ENABLED === 'true' && process.env.NAVYIX_TEAM_ENABLED === 'true';
  if (!enabled) return <main style={{ padding: '3rem', maxWidth: 760, margin: 'auto' }}>
    <h1>Project team access</h1><p>This capability is not enabled. It requires authenticated server storage and the project-team database acceptance checks.</p>
    <Link href="/workspace">Back to workspace</Link>
  </main>;
  return <>{createElement('navyix-project-team')}
    <Script src="/workbench/team.mjs" type="module" strategy="afterInteractive" />
    <noscript>JavaScript is required. Customer member details are not embedded in this page.</noscript></>;
}
