/**
 * App branding — override via VITE_APP_TITLE / VITE_APP_TITLE_SHORT (and
 * optionally VITE_APP_DESCRIPTION) so a deployment for a different company
 * doesn't require editing source. Defaults match the original hardcoded copy.
 */

const DEFAULT_TITLE = 'Consumer Cases Monitor';
const DEFAULT_TITLE_SHORT = 'Case Monitor';
const DEFAULT_DESCRIPTION =
  'Consumer Cases Monitor — litigation intelligence dashboard for C-suite and in-house legal teams.';

const envTitle = (import.meta.env.VITE_APP_TITLE as string | undefined)?.trim();
const envTitleShort = (import.meta.env.VITE_APP_TITLE_SHORT as string | undefined)?.trim();
const envDescription = (import.meta.env.VITE_APP_DESCRIPTION as string | undefined)?.trim();

export const APP_TITLE = envTitle || DEFAULT_TITLE;
export const APP_TITLE_SHORT = envTitleShort || envTitle || DEFAULT_TITLE_SHORT;
export const APP_DESCRIPTION = envDescription || (envTitle ? APP_TITLE : DEFAULT_DESCRIPTION);

/** Apply APP_TITLE/APP_DESCRIPTION to document.title and the title/description meta tags. */
export function applyBrandingToDocument(): void {
  document.title = APP_TITLE;

  const setMeta = (selector: string, content: string) => {
    document.head.querySelector(selector)?.setAttribute('content', content);
  };
  setMeta('meta[name="description"]', APP_DESCRIPTION);
  setMeta('meta[property="og:title"]', APP_TITLE);
  setMeta('meta[property="og:description"]', APP_DESCRIPTION);
  setMeta('meta[name="twitter:title"]', APP_TITLE);
  setMeta('meta[name="twitter:description"]', APP_DESCRIPTION);
}
