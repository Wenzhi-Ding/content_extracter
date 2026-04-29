/**
 * Shared image detection patterns for tracking, social, and junk images.
 * Used by both content/sanitizers.ts (DOM-level) and lib/turndown.ts (Turndown rules).
 */

export const TRACKING_IMAGE_PATTERNS = [
  /\.gif(\?|$)/i,
  /tracking/i,
  /pixel/i,
  /beacon/i,
  /open\.\w+\.com/i,
  /sailthru\.com/i,
  /doubleclick/i,
  /analytics/i,
  /sli\.reutersmedia\.net/i,
  /movable-ink/i,
  /movableink/i,
  /liadm\.com/i,
  /li\.mail\.liadm\.com/i,
  /adchoices/i,
  /aboutads\.info/i,
  /privacy-?icon/i,
  /adsymptotic\.com/i,
  /email-?open/i,
  /\.list-manage\.com\/track/i,
  /mailchimp\.com.*\/track/i,
  /e\.newsletters\./i,
  /newslink\.reuters\.com\/img/i,
  /link\.foreignaffairs\.com\/img/i,
  /mapcdn\.ft\.com.*\.gif/i,
  /mapcdn\.ft\.com.*\/open/i,
];

export const SOCIAL_IMAGE_PATTERNS = [
  /facebook.*icon/i,
  /twitter.*icon/i,
  /instagram.*icon/i,
  /linkedin.*icon/i,
  /youtube.*icon/i,
  /x\.com.*icon/i,
  /social.*icon/i,
  /social[-_]?media/i,
  /icon[-_]?(fb|tw|ig|li|yt|x)\b/i,
  /\/(fb|twitter|instagram|linkedin|youtube|x)[-_.]*(icon|logo|badge)/i,
  /\/ico-social/i,
];

export const JUNK_IMAGE_ALT_PATTERNS = [
  /^liveintent/i,
  /liveintent\s*logo/i,
  /^adchoices/i,
  /adchoices\s*logo/i,
  /^powered\s*by\s*(zeta|liveintent|sailthru)/i,
  /^download\s*the\s+\w+\s+app/i,
];

export interface ImageAttributes {
  src: string;
  alt: string;
  title: string;
  width: number | null;
  height: number | null;
}

/**
 * Determines if an image is a tracking pixel, social icon, or junk image
 * based on its attributes. Works for both DOM elements and Turndown nodes.
 */
export function isJunkImage(attrs: ImageAttributes): boolean {
  const { src, alt, title, width, height } = attrs;
  const hasExplicitSize = width !== null && height !== null;

  if (hasExplicitSize && width! <= 3 && height! <= 3) return true;

  const isTrackingUrl = TRACKING_IMAGE_PATTERNS.some(p => p.test(src));
  if (isTrackingUrl && !alt) return true;
  if (/movable-ink|movableink|liadm\.com|sailthru\.com/i.test(src)) return true;
  if (!alt && !title && isTrackingUrl) return true;
  if (alt && JUNK_IMAGE_ALT_PATTERNS.some(p => p.test(alt))) return true;
  if (SOCIAL_IMAGE_PATTERNS.some(p => p.test(src))) return true;
  if (SOCIAL_IMAGE_PATTERNS.some(p => p.test(alt))) return true;

  return false;
}

/**
 * Parse a size attribute value to a number, returning null if invalid.
 */
export function parseSizeAttr(val: string): number | null {
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}
