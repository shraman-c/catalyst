import DOMPurify from 'isomorphic-dompurify';

/**
 * Allowlist-based HTML sanitizer (audit 3.4 / 3.5).
 *
 * Runs DOMPurify over HTML produced by marked.parse() as a defense-in-depth
 * layer on top of the markdown escaping in the renderer. DOMPurify strips
 * scripts, event-handler attributes, and javascript: URLs regardless of how
 * the markup got in (user note, AI-generated card, manipulated prompt).
 *
 * isomorphic-dompurify works in both RSC (server) and client components.
 */

export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    USE_PROFILES: { html: true },
  });
}
