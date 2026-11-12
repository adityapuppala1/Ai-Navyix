import { createElement } from 'react';
import Script from 'next/script';

export const dynamic = 'force-dynamic';
export default function WorkspacePage() {
  // An explicit server configuration switch, not a query parameter or browser preference.
  const connected = process.env.NAVYIX_BROWSER_ENABLED === 'true';
  return <>
    {createElement(connected ? 'navyix-connected-workbench' : 'navyix-workbench')}
    <Script src={connected ? '/workbench/connected.mjs' : '/workbench/app.mjs'} type="module" strategy="afterInteractive" />
    <noscript>This workspace needs JavaScript. No authenticated project data is embedded in this page.</noscript>
  </>;
}
