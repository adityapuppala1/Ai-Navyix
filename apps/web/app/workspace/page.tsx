'use client';

import { createElement } from 'react';
import Script from 'next/script';

/** Shared native component: canonical sources are copied by the pre-build script. */
export default function Workspace() {
  return (
    <>
      <Script src="/workbench/app.mjs" type="module" strategy="afterInteractive" />
      {createElement('navyix-workbench')}
      <noscript>Enable JavaScript to use the Navyix local workbench.</noscript>
    </>
  );
}
