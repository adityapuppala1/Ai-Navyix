import { createElement } from 'react';
import Script from 'next/script';
import Link from 'next/link';

export const dynamic = 'force-dynamic';
export default function EvidenceHistoryPage() {
  if (process.env.NAVYIX_BROWSER_ENABLED !== 'true' || process.env.NAVYIX_JOURNAL_ENABLED !== 'true') {
    return <main style={{ padding: '3rem' }}><h1>Saved evidence is not enabled</h1><p>Enable only after the documented database and authentication acceptance checks.</p><Link href="/workspace">Back to workspace</Link></main>;
  }
  return <>{createElement('navyix-evidence-history')}<Script src="/workbench/journal.mjs" type="module" strategy="afterInteractive" /><noscript>JavaScript and an authenticated session are required. No project data is embedded in this page.</noscript></>;
}
