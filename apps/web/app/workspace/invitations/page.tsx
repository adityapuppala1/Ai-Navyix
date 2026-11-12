import { createElement } from 'react';
import Script from 'next/script';
import Link from 'next/link';
export const dynamic = 'force-dynamic';
export default function InvitationsPage() {
  if (process.env.NAVYIX_BROWSER_ENABLED !== 'true' || process.env.NAVYIX_INVITATIONS_ENABLED !== 'true') {
    return <main><h1>Invitations are not enabled</h1><Link href="/workspace">Return to workspace</Link></main>;
  }
  return <>{createElement('navyix-invitations')}<Script src="/workbench/invitations.mjs" type="module" strategy="afterInteractive" />
    <noscript>JavaScript is required. No invitation code is embedded in this page.</noscript></>;
}
