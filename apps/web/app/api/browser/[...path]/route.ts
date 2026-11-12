import { serveBrowser } from '../../../../lib/browser';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const GET = serveBrowser;
export const POST = serveBrowser;
// Explicitly denied rather than permitting implicit endpoint behavior.
export const PUT = serveBrowser;
export const PATCH = serveBrowser;
export const DELETE = serveBrowser;
export const HEAD = serveBrowser;
export const OPTIONS = serveBrowser;
