import { createElement } from 'react';
import Script from 'next/script';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export default function WorkspacePage() {
  // An explicit server configuration switch, not a query parameter or browser preference.
  const connected = process.env.NAVYIX_BROWSER_ENABLED === 'true';
  return <>
    {connected && process.env.NAVYIX_TEAM_ENABLED === 'true' && <nav aria-label="Administration" style={{ padding: '12px 24px' }}><Link href="/workspace/team">Manage project team access →</Link></nav>}
    {createElement(connected ? 'navyix-connected-workbench' : 'navyix-workbench')}
    <Script src={connected ? '/workbench/connected.mjs' : '/workbench/app.mjs'} type="module" strategy="afterInteractive" />
    <noscript>This workspace needs JavaScript. No authenticated project data is embedded in this page.</noscript>
  </>;
}
