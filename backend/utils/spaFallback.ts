/**
 * Paths answered with index.html (client-side routes such as /analytics, /incidents).
 * Not /api/, /tiles/ or /imagery/: an unknown image or tile URL must be a 404, never HTML that
 * the CDN would cache under a .png name.
 */
export const SPA_FALLBACK_RE = /^\/(?!api\/|tiles\/|imagery\/).*/;
