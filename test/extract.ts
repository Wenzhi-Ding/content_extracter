/**
 * Test harness for BrowserClaw email extraction pipeline.
 *
 * Usage:  npx tsx test/extract.ts [filename]
 *   - No args  → process all test/*.html
 *   - With arg → process only that file, e.g. `npx tsx test/extract.ts reuters`
 *
 * Outputs: test/output/<name>.md for each input file.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { resolve, basename, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import TurndownService from 'turndown';

// ---------------------------------------------------------------------------
// 1. Safelink / URL cleaning  (mirrors src/content/link-cleaner.ts)
// ---------------------------------------------------------------------------

function isSafeLink(hostname: string): boolean {
  return hostname.endsWith('safelinks.protection.outlook.com');
}

const REDIRECT_HOSTS: Record<string, string> = {
  'www.google.com': 'q',
  'slack-redir.net': 'url',
  'l.facebook.com': 'u',
};

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_cid',
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid',
  'mc_cid', 'mc_eid',
  '_hsenc', '_hsmi', 'hsCtaTracking',
  'ref', 'ref_src', 'ref_url',
  'source', 'ust', 'usg',
  'sdata', 'reserved',
  'data',
  'mkt_tok',
  'trk', 'trkCampaign', 'trkInfo',
  'si', 'feature',
  'oly_enc_id', 'oly_anon_id',
  'vero_id', 'vero_conv',
  'wickedid',
  's_kwcid', 'ef_id',
  'epik',
  'lctg',
  'segmentid',
  'xnpe_tifc', 'xnpe_cmp',
  'cid',
]);

/** Hosts that encode the destination URL as a base64url segment in the path. */
const BASE64_REDIRECT_HOSTS = new Set([
  'newslink.reuters.com',
  'link.foreignaffairs.com',
]);

/**
 * Try to extract the real URL from newsletter redirect wrappers that use
 * base64url-encoded destination in their path:
 *   https://newslink.reuters.com/click/<id>/<base64url_dest>/<hex>
 *   https://link.foreignaffairs.com/click/<id>/<base64url_dest>/<hex>
 */
function unwrapBase64Redirect(url: string, parsed: URL): string | null {
  if (!BASE64_REDIRECT_HOSTS.has(parsed.hostname)) return null;
  const pathType = parsed.pathname.split('/')[1]; // "click" or "external"
  if (pathType !== 'click' && pathType !== 'external') return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  // segments: [click|external, <id>, <base64url>, <hex>]
  if (segments.length < 3) return null;

  const b64 = segments[2];
  try {
    const decoded = Buffer.from(b64, 'base64url').toString('utf-8');
    if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
      return decoded;
    }
  } catch {
    // not valid base64
  }
  return null;
}

function unwrapRedirect(url: string): string {
  try {
    const parsed = new URL(url);

    if (isSafeLink(parsed.hostname)) {
      const original = parsed.searchParams.get('url');
      if (original) {
        return unwrapRedirect(decodeURIComponent(original)); // recurse — may be double-wrapped
      }
    }

    const paramName = REDIRECT_HOSTS[parsed.hostname];
    if (paramName) {
      const original = parsed.searchParams.get(paramName);
      if (original) {
        return decodeURIComponent(original);
      }
    }

    // Base64-encoded redirect wrappers (Reuters, Foreign Affairs)
    const b64Result = unwrapBase64Redirect(url, parsed);
    if (b64Result) {
      return unwrapRedirect(b64Result); // recurse — decoded URL may still have tracking params
    }
  } catch {
    return url;
  }
  return url;
}

function stripTrackingParams(url: string): string {
  try {
    const parsed = new URL(url);
    const keysToRemove: string[] = [];
    parsed.searchParams.forEach((_value, key) => {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        keysToRemove.push(key);
      }
    });
    keysToRemove.forEach(k => parsed.searchParams.delete(k));
    let cleaned = parsed.origin + parsed.pathname;
    const remaining = parsed.searchParams.toString();
    if (remaining) cleaned += '?' + remaining;
    if (parsed.hash) cleaned += parsed.hash;
    return cleaned;
  } catch {
    return url;
  }
}

function cleanUrl(url: string): string {
  let cleaned = unwrapRedirect(url);
  cleaned = stripTrackingParams(cleaned);
  return cleaned;
}

// JUNK_LINK_PATTERNS — links we never want in the output
const JUNK_LINK_PATTERNS = [
  /^mailto:/i,
  /^tel:/i,
  /^javascript:/i,
  /^#/,
  /unsubscribe/i,
  /opt[\-_]?out/i,
  /manage[\-_]?preferences/i,
  /email[\-_]?preferences/i,
  /notification[\-_]?settings/i,
  /privacy[\-_]?policy/i,
  /terms[\-_]?(of[\-_]?service|and[\-_]?conditions|of[\-_]?use)/i,
  /cookie[\-_]?policy/i,
  /legal[\-_]?notice/i,
  /contact[\-_]?us/i,
  /help[\-_]?center/i,
  /support\..*\.com\/?$/i,
  /^https?:\/\/aka\.ms\//i,
  /\/about\?u=/i,   // Mailchimp "why did I get this"
  /\/profile\?u=/i, // Mailchimp "update preferences"
];

const JUNK_ANCHOR_PATTERNS = [
  /^unsubscribe$/i,
  /^opt[\s\-_]?out$/i,
  /^manage\s*(email\s*)?preferences$/i,
  /^view\s*(in|this\s*email\s*in)\s*(your\s*)?browser$/i,
  /^privacy\s*policy$/i,
  /^terms/i,
  /^legal/i,
  /^cookie/i,
  /^update\s*your\s*preferences$/i,
  /^click\s*here\s*to\s*unsubscribe$/i,
  /^why\s+did\s+I\s+get\s+this\??$/i,
  /^(here\.?)$/i,
];

function isJunkLink(url: string, anchorText: string): boolean {
  for (const pattern of JUNK_LINK_PATTERNS) {
    if (pattern.test(url)) return true;
  }
  const trimmed = anchorText.trim();
  if (trimmed) {
    for (const pattern of JUNK_ANCHOR_PATTERNS) {
      if (pattern.test(trimmed)) return true;
    }
  }
  return false;
}

function shouldKeepLink(url: string, anchorText: string): boolean {
  return !isJunkLink(url, anchorText);
}

// ---------------------------------------------------------------------------
// 2. Tracking / noise image detection  (enhanced)
// ---------------------------------------------------------------------------

const TRACKING_IMAGE_URL_PATTERNS = [
  /\.gif(\?|$)/i,
  /tracking/i,
  /pixel/i,
  /beacon/i,
  /open\.\w+\.com/i,
  /sailthru\.com/i,
  /doubleclick/i,
  /analytics/i,
  // Newsletter-specific tracking / ad image domains
  /sli\.reutersmedia\.net/i,
  /movable-ink/i,
  /movableink/i,
  /liadm\.com/i,           // LiveIntent
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

/** Social media icon image patterns */
const SOCIAL_IMAGE_PATTERNS = [
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

const JUNK_IMAGE_ALT_PATTERNS = [
  /^liveintent/i,
  /liveintent\s*logo/i,
  /^adchoices/i,
  /adchoices\s*logo/i,
  /^powered\s*by\s*(zeta|liveintent|sailthru)/i,
  /^download\s*the\s+\w+\s+app/i,
];

function isTrackingOrJunkImage(img: Element): boolean {
  const src = img.getAttribute('src') || '';
  const alt = (img.getAttribute('alt') || '').trim();
  const title = (img.getAttribute('title') || '').trim();
  const attrWidth = parseInt(img.getAttribute('width') || '', 10);
  const attrHeight = parseInt(img.getAttribute('height') || '', 10);
  const hasExplicitSize = !isNaN(attrWidth) && !isNaN(attrHeight);

  // 1×1, 0×0, etc. tracking pixels
  if (hasExplicitSize && attrWidth <= 3 && attrHeight <= 3) return true;

  // Known tracking / ad image URL patterns (kill regardless of alt text for ad domains)
  const isTrackingUrl = TRACKING_IMAGE_URL_PATTERNS.some(p => p.test(src));
  if (isTrackingUrl && !alt) return true;
  // movable-ink, liadm, sailthru — always junk even with alt text
  if (/movable-ink|movableink|liadm\.com|sailthru\.com/i.test(src)) return true;

  // Known no-alt tracking images
  if (!alt && !title && isTrackingUrl) return true;

  // Junk alt text patterns (LiveIntent Logo, AdChoices Logo, etc.)
  if (alt && JUNK_IMAGE_ALT_PATTERNS.some(p => p.test(alt))) return true;

  // Social media icons
  if (SOCIAL_IMAGE_PATTERNS.some(p => p.test(src))) return true;
  if (SOCIAL_IMAGE_PATTERNS.some(p => p.test(alt))) return true;

  return false;
}

// ---------------------------------------------------------------------------
// 3. Boilerplate / footer detection
// ---------------------------------------------------------------------------

const BOILERPLATE_PATTERNS = [
  /unsubscribe/i,
  /opt[\s\-_]?out/i,
  /manage\s*(your\s*)?(email\s*)?preferences/i,
  /email[\s\-_]?preferences/i,
  /view\s*(in|this\s*email\s*in)\s*(your\s*)?browser/i,
  /privacy\s*(statement|policy)/i,
  /terms\s*(of\s*use|&\s*conditions|and\s*conditions)/i,
  /cookie\s*policy/i,
  /©\s*\d{4}/,
  /all\s*rights\s*reserved/i,
  /limited\s*tracking/i,
  /personal\s*information/i,
  /forward\s*this\s*(newsletter|email)/i,
  /sign\s*up\s*here/i,
  /want\s*to\s*stop\s*receiving/i,
  /you('re|\s+are)\s+receiving\s+this/i,
  /was\s+sent\s+to\s+you/i,
  /由\s*Outlook\s*保护/i,
  /单击或点击以打开链接/i,
  /sponsors?\s*(are)?\s*not\s*involved/i,
  /advertise\s*with\s*us/i,
  /do\s*not\s*sell\s*my\s*personal/i,
  /california\s*privacy/i,
  /powered\s*by\s*sailthru/i,
  /this\s+email\s+(was\s+)?sent\s+(to|by)/i,
  /why\s+did\s+I\s+get\s+this/i,
  /add\s+us\s+to\s+your\s+(email\s+)?address\s+book/i,
  /update\s+(your\s+)?(subscription|email)\s*preferences/i,
  /receiving\s+too\s+many\s+emails/i,
  /we\s+use\s+pixels/i,
  /please\s+add\s+us\s+to/i,
  /safe\s*list/i,
  /registered\s+in\s+england/i,
  /company\s+number\s+\d+/i,
];

function isBoilerplateNode(el: Element): boolean {
  const text = el.textContent || '';
  if (text.trim().length < 5) return false;

  // Short text blocks with even 1 boilerplate match are boilerplate
  const isShort = text.trim().length < 100;

  let matchCount = 0;
  for (const pattern of BOILERPLATE_PATTERNS) {
    if (pattern.test(text)) {
      matchCount++;
      if (matchCount >= 2) return true;
      if (isShort && matchCount >= 1) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// 4. HTML sanitization  (mirrors src/content/index.ts sanitizeEmailHtml)
// ---------------------------------------------------------------------------

function sanitizeEmailHtml(container: Element): void {
  // Remove preheader / hidden preview text
  const hiddenEls = container.querySelectorAll(
    '[style*="display:none"], [style*="display: none"], ' +
    '.sailthru-emco-preheader, .x_sailthru-emco-preheader, ' +
    '[class*="preheader"], [class*="preview-text"]'
  );
  for (const el of hiddenEls) {
    const style = el.getAttribute('style') || '';
    if (style.includes('display:none') || style.includes('display: none') ||
        el.classList.contains('sailthru-emco-preheader') ||
        el.classList.contains('x_sailthru-emco-preheader') ||
        el.className?.includes?.('preheader') ||
        el.className?.includes?.('preview-text')) {
      el.remove();
    }
  }

  // Remove tracking / ad / social images
  const images = container.querySelectorAll('img');
  for (const img of images) {
    if (isTrackingOrJunkImage(img)) {
      const parent = img.parentElement;
      img.remove();
      // If parent is now-empty <a>, remove that too
      if (parent?.tagName === 'A' && !parent.textContent?.trim()) {
        parent.remove();
      }
    }
  }

  // Remove empty decoration tables
  const tables = Array.from(container.querySelectorAll('table[role="presentation"]'));
  for (let i = tables.length - 1; i >= 0; i--) {
    const table = tables[i];
    const text = (table.textContent || '').trim();
    const contentLinks = table.querySelectorAll('a[href]');
    if (text.length === 0 && contentLinks.length === 0) {
      table.remove();
    }
  }

  // Remove boilerplate nodes
  const allElements = container.querySelectorAll('div, p, td, tr, section, aside');
  for (const el of allElements) {
    if (!el.parentElement) continue;
    const children = el.children;
    const text = (el.textContent || '').trim();

    if (text.length > 0 && text.length < 200 && isBoilerplateNode(el)) {
      const hasArticleContent = el.querySelector('article, h1, h2, h3, h4, h5, h6');
      if (!hasArticleContent && children.length <= 2) {
        el.remove();
      }
    }

    // Remove totally empty elements
    if (children.length === 0 && text === '') {
      el.remove();
    }
  }

  // Unwrap safelinks in <a href="..."> attributes (in-place)
  const links = container.querySelectorAll('a[href]');
  for (const a of links) {
    let href = a.getAttribute('href') || '';

    // Fix Outlook broken URLs: "outlook.live.comhttps://..." → remove prefix
    href = href.replace(/^https?:\/\/outlook\.live\.com(?=https?:\/\/)/, '');

    // Fix null prefix on mailto: "nulluser@example.com" → "mailto:user@example.com"
    if (href.startsWith('null') && href.includes('@') && !href.startsWith('nullhttp')) {
      href = 'mailto:' + href.substring(4);
    }

    if (href) {
      const cleaned = cleanUrl(href);
      a.setAttribute('href', cleaned);
    }
    // Remove "由 Outlook 保护" title attributes
    const title = a.getAttribute('title') || '';
    if (/由\s*Outlook\s*保护/.test(title) || /单击或点击/.test(title)) {
      a.removeAttribute('title');
    }
    // Use originalsrc if available (often cleaner than safelink href)
    const originalSrc = a.getAttribute('originalsrc');
    if (originalSrc) {
      let cleanedOriginal = originalSrc;
      cleanedOriginal = cleanedOriginal.replace(/^https?:\/\/outlook\.live\.com(?=https?:\/\/)/, '');
      cleanedOriginal = cleanUrl(cleanedOriginal);
      a.setAttribute('href', cleanedOriginal);
      a.removeAttribute('originalsrc');
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Turndown setup  (mirrors src/lib/turndown.ts — single instance for email)
// ---------------------------------------------------------------------------

function createEmailTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
  });

  // Skip GFM plugin for email — it crashes on layout tables with missing parentNode

  // Remove script / style
  td.remove(['script', 'style']);

  // Remove tracking images (Turndown level — catches ones missed by DOM sanitization)
  td.addRule('removeTrackingImages', {
    filter: (node: HTMLElement) => {
      if (node.nodeName !== 'IMG') return false;
      return isTrackingOrJunkImage(node);
    },
    replacement: () => '',
  });

  // Flatten layout tables (role="presentation") — use the SAME td instance
  // so that tracking image rules are preserved
  td.addRule('emailLayoutTables', {
    filter: (node: HTMLElement) => {
      if (node.nodeName !== 'TABLE') return false;
      const role = node.getAttribute('role');
      return role === 'presentation';
    },
    replacement: (_content: string, node: HTMLElement) => {
      // Re-process inner HTML through a fresh TurndownService that still has
      // the tracking image rules
      const inner = node.innerHTML || '';
      const nested = createEmailTurndown();
      return nested.turndown(inner) + '\n\n';
    },
  });

  // Remove links that are just junk (unsubscribe, etc.)
  td.addRule('removeJunkLinks', {
    filter: (node: HTMLElement) => {
      if (node.nodeName !== 'A') return false;
      const href = node.getAttribute('href') || '';
      const text = (node.textContent || '').trim();
      return !shouldKeepLink(href, text);
    },
    replacement: (_content: string, node: HTMLElement) => {
      // Keep text but strip the link
      return (node.textContent || '').trim();
    },
  });

  // Strip image-only links where the image was removed (empty <a>)
  td.addRule('removeEmptyLinks', {
    filter: (node: HTMLElement) => {
      if (node.nodeName !== 'A') return false;
      const text = (node.textContent || '').trim();
      if (text) return false;
      // No text, no children with content
      return node.children.length === 0 || !node.innerHTML?.trim();
    },
    replacement: () => '',
  });

  return td;
}

// ---------------------------------------------------------------------------
// 6. Markdown post-processing
// ---------------------------------------------------------------------------

function cleanMarkdownLinks(markdown: string): string {
  return markdown.replace(
    /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_match, text: string, url: string) => {
      let cleanedUrl = url;

      // Fix Outlook broken URLs in markdown
      cleanedUrl = cleanedUrl.replace(/^https?:\/\/outlook\.live\.com(?=https?:\/\/)/, '');

      // Fix null-prefixed mailto
      if (cleanedUrl.startsWith('null') && cleanedUrl.includes('@') && !cleanedUrl.startsWith('nullhttp')) {
        cleanedUrl = 'mailto:' + cleanedUrl.substring(4);
      }

      if (!shouldKeepLink(cleanedUrl, text)) return text;
      cleanedUrl = cleanUrl(cleanedUrl);
      return `[${text}](${cleanedUrl})`;
    }
  );
}

function cleanMarkdownContent(markdown: string): string {
  let cleaned = markdown;

  // Remove zero-width spaces, combining grapheme joiner, soft hyphens, BOM,
  // and Private Use Area characters (U+E000–U+F8FF) — Outlook inserts PUA chars
  // like U+E113 that end up inside bold markers creating orphan "**" lines
  cleaned = cleaned.replace(/[\u200B\u200C\u200D\uFEFF\u034F\u00AD\u00A0\uE000-\uF8FF]/g, function(ch) {
    // Replace NBSP with regular space (don't delete it entirely)
    if (ch === '\u00A0') return ' ';
    return '';
  });

  // Strip empty bold/italic markers: lines that are just ** or * with no real content
  cleaned = cleaned.replace(/^\*{1,3}\s*$/gm, '');

  // Remove copyright lines
  cleaned = cleaned.replace(/^.*©\s*\d{4}.*$/gm, '');
  cleaned = cleaned.replace(/^.*All\s*rights?\s*reserved.*$/gim, '');

  // Remove "由 Outlook 保护" tooltip text in square brackets or parens
  cleaned = cleaned.replace(/由\s*Outlook\s*保护[:：]?[^。]*[。]?/g, '');
  cleaned = cleaned.replace(/单击或点击以打开链接[。.]?/g, '');

  // Remove standalone image references with no alt text: ![](url) or [![][n]](url)
  cleaned = cleaned.replace(/^!\[\]\([^)]+\)\s*$/gm, '');
  cleaned = cleaned.replace(/^\[!\[\]\[[^\]]*\]\]\([^)]+\)\s*$/gm, '');
  // Images with alt text "无配图" (Caixin placeholder)
  cleaned = cleaned.replace(/^!\[无配图\]\[[^\]]*\]\s*$/gm, '');

  // Remove "Sponsors are not involved..." boilerplate lines
  cleaned = cleaned.replace(/^.*Sponsors?\s*(are)?\s*not\s*involved.*$/gim, '');
  cleaned = cleaned.replace(/^.*Advertise\s*with\s*us.*$/gim, '');

  // Remove image credit lines (REUTERS/..., AFP/..., Getty/...)
  cleaned = cleaned.replace(/^(REUTERS|AFP|AP|Getty\s*Images?)\/[^\n]*$/gm, '');

  // "View in Browser" / "View online" — handle inline [text](url) and reference [text][n] formats
  cleaned = cleaned.replace(/^\[?View\s*(in\s*Browser|online|in\s*your\s*browser)\]?\s*(\([^)]*\)|\[[^\]]*\])?\s*$/gim, '');
  cleaned = cleaned.replace(/^邮件无法正常浏览.*$/gm, '');

  // Remove "This email includes limited tracking..." / pixel disclosure boilerplate
  cleaned = cleaned.replace(/^.*This\s+email\s+includes\s+limited\s+tracking.*$/gim, '');
  cleaned = cleaned.replace(/^.*We\s+use\s+pixels\s+in\s+HTML\s+emails.*$/gim, '');
  cleaned = cleaned.replace(/^.*The\s+pixel\s+will\s+be\s+deleted.*$/gim, '');
  cleaned = cleaned.replace(/^.*See\s+our\s+cookie\s+policy\s+for\s+more.*$/gim, '');

  // Remove "This email was sent by/to..." boilerplate lines
  cleaned = cleaned.replace(/^.*This\s+email\s+(was\s+)?sent\s+(to|by)\b.*$/gim, '');

  // Remove "To ensure we can contact you, please add us..." lines
  cleaned = cleaned.replace(/^.*please\s+add\s+us\s+to\s+your.*$/gim, '');

  // Remove "Receiving too many emails? Unsubscribe..." lines
  cleaned = cleaned.replace(/^.*Receiving\s+too\s+many\s+emails\?.*$/gim, '');

  // Remove Terms & Conditions standalone lines
  cleaned = cleaned.replace(/^\s*Terms\s*&\s*Conditions\s*$/gim, '');

  // Remove address-style footer lines (City, State ZIP · Country)
  cleaned = cleaned.replace(/^[A-Za-z\s.·,]+\d{5,6}\s*·\s*[A-Za-z]+\s*$/gm, '');
  // Mailchimp-style company address blocks (multiple · separated segments)
  cleaned = cleaned.replace(/^.+·.+·.+\d{5,6}.+$/gm, '');

  // "why did I get this? unsubscribe from this list update subscription preferences"
  cleaned = cleaned.replace(/^.*why\s+did\s+I\s+get\s+this\?.*$/gim, '');
  cleaned = cleaned.replace(/^.*unsubscribe\s+from\s+this\s+list.*$/gim, '');
  cleaned = cleaned.replace(/^.*update\s+subscription\s+preferences.*$/gim, '');

  // Remove newsletter editor/editor credit lines
  cleaned = cleaned.replace(/^This\s+newsletter\s+was\s+edited\s+by\s+.+$/gim, '');

  // Remove "Sponsored by" lines
  cleaned = cleaned.replace(/^Sponsored\s+by\s+\[.*$/gm, '');

  // Remove advertisement blocks
  cleaned = cleaned.replace(/^Advertisement:?\s+.*$/gim, '');

  // Remove "尚未订阅..." / subscription CTA lines
  cleaned = cleaned.replace(/^尚未订阅.*$/gm, '');
  cleaned = cleaned.replace(/^\[立即订阅\].*$/gm, '');
  cleaned = cleaned.replace(/^分享给好友.*$/gm, '');
  cleaned = cleaned.replace(/^\[打开网页版\].*$/gm, '');

  // Ad CTAs
  cleaned = cleaned.replace(/^\[?\*?\*?Read\s+it\s+free\*?\*?\]?\s*(\([^)]*\)|\[[^\]]*\])?\s*$/gim, '');

  // Remove empty table cells / pipes
  cleaned = cleaned.replace(/^\|?\s*\|?\s*$/gm, '');

  // Collapse excessive blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  cleaned = cleaned.trim();
  return cleaned;
}

/**
 * Post-conversion cleanup: patterns that only match after reference-style conversion
 */
function cleanAfterReferenceConversion(markdown: string): string {
  let cleaned = markdown;

  // "View online" in reference format: [View online][N]
  cleaned = cleaned.replace(/^\[View\s*(in\s*Browser|online|in\s*your\s*browser)\]\[\d+\]\s*$/gim, '');

  // 邮件无法正常浏览？ [通过浏览器查看 ››][N]
  cleaned = cleaned.replace(/^邮件无法正常浏览.*$/gm, '');

  // ![无配图]... leftover (unlikely but defensive)
  cleaned = cleaned.replace(/^!\[无配图\].*$/gm, '');

  // Orphaned reference-style image links pointing to broken outlook.live.com UUIDs
  // These show up as [![][N]](outlook-url) before conversion — but after they become [![][N]][M]
  // Already handled above

  // Collapse excessive blank lines again
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.trim();

  return cleaned;
}

/**
 * Remove unused references after content cleanup.
 * If a reference [N]: url exists but [N] is no longer used in body text, drop it.
 */
function removeUnusedReferences(markdown: string): string {
  const lines = markdown.split('\n');
  const bodyLines: string[] = [];
  const refLines: string[] = [];

  for (const line of lines) {
    if (/^\[\d+\]:\s/.test(line)) {
      refLines.push(line);
    } else {
      bodyLines.push(line);
    }
  }

  if (refLines.length === 0) return markdown;

  const body = bodyLines.join('\n');
  const usedRefs = refLines.filter(ref => {
    const match = ref.match(/^\[(\d+)\]:/);
    if (!match) return true;
    const idx = match[1];
    // Check if [N] appears in body (as [text][N] or [][N])
    return body.includes(`][${idx}]`);
  });

  return bodyLines.join('\n') + '\n\n' + usedRefs.join('\n');
}

/**
 * Renumber reference indices to be sequential starting from 1.
 * After cleanup may leave gaps (e.g. [8], [9], [10]...) — compact to [1], [2], [3]...
 */
function renumberReferences(markdown: string): string {
  const lines = markdown.split('\n');
  const bodyLines: string[] = [];
  const refLines: string[] = [];

  for (const line of lines) {
    if (/^\[\d+\]:\s/.test(line)) {
      refLines.push(line);
    } else {
      bodyLines.push(line);
    }
  }

  if (refLines.length === 0) return markdown;

  // Parse old indices and build mapping: oldIdx → newIdx
  const oldToNew = new Map<number, number>();
  let newIdx = 1;
  for (const ref of refLines) {
    const m = ref.match(/^\[(\d+)\]:/);
    if (m) {
      const oldIdx = parseInt(m[1], 10);
      if (!oldToNew.has(oldIdx)) {
        oldToNew.set(oldIdx, newIdx++);
      }
    }
  }

  // Check if already sequential
  let alreadySequential = true;
  for (const [old, nw] of oldToNew) {
    if (old !== nw) { alreadySequential = false; break; }
  }
  if (alreadySequential) return markdown;

  // Replace in body: ][oldIdx] → ][newIdx]
  let body = bodyLines.join('\n');
  for (const [old, nw] of oldToNew) {
    // Replace all occurrences of ][old] with ][new]
    body = body.replaceAll(`][${old}]`, `][${nw}]`);
  }

  // Rebuild reference lines with new indices
  const newRefLines = refLines.map(ref => {
    const m = ref.match(/^\[(\d+)\]:\s(.*)$/);
    if (!m) return ref;
    const oldIdx = parseInt(m[1], 10);
    const url = m[2];
    const mapped = oldToNew.get(oldIdx);
    return `[${mapped ?? oldIdx}]: ${url}`;
  });

  return body + '\n\n' + newRefLines.join('\n');
}

const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|svg|webp|bmp|ico|avif|tiff?)(\?|#|$)/i;

function isImageUrl(url: string): boolean {
  if (IMAGE_EXTENSIONS.test(url)) return true;
  if (/^data:image\//i.test(url)) return true;
  return false;
}

function convertToReferenceLinks(markdown: string): string {
  const urlToIndex = new Map<string, number>();
  let nextIndex = 1;

  function getOrCreateIndex(url: string): number {
    if (!urlToIndex.has(url)) {
      urlToIndex.set(url, nextIndex++);
    }
    return urlToIndex.get(url)!;
  }

  // Pass 1: ![alt](url) → remove entirely (image references not needed)
  let body = markdown.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    () => ''
  );

  // Pass 2: [text](url) → [text][N], but skip image URLs
  body = body.replace(
    /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_match, text: string, url: string) => {
      if (isImageUrl(url)) return text; // strip link, keep text
      const idx = getOrCreateIndex(url);
      return `[${text}][${idx}]`;
    }
  );

  // Pass 3: [![alt][N]](url) → remove (linked images)
  body = body.replace(
    /(\[!\[[^\]]*\]\[\d+\])\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    () => ''
  );

  if (urlToIndex.size === 0) return markdown;

  // Phase 2: Build reference list
  const refs = Array.from(urlToIndex.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([url, idx]) => `[${idx}]: ${url}`)
    .join('\n');

  return body + '\n\n' + refs;
}

// ---------------------------------------------------------------------------
// 7. Content element detection  (mirrors src/content/selectors.ts)
// ---------------------------------------------------------------------------

const OUTLOOK_SELECTORS = [
  '[id^="UniqueMessageBody"]',
  '[aria-label="邮件正文"]',
  '[aria-label="Message body"]',
  '[role="document"][aria-label]',
];

function findContentElement(doc: Document): Element | null {
  for (const sel of OUTLOOK_SELECTORS) {
    const el = doc.querySelector(sel);
    if (el) return el;
  }
  // Fallback: look for the rps_ class container (Outlook renders email body here)
  const rps = doc.querySelector('[class^="rps_"]');
  if (rps) return rps;
  return doc.body;
}

// ---------------------------------------------------------------------------
// 8. Page metadata extraction (title, canonical URL, publication date)
// ---------------------------------------------------------------------------

function extractPageTitle(doc: Document): string {
  return doc.title?.trim() || 'Untitled';
}

function extractCanonicalUrl(doc: Document): string {
  return (
    doc.querySelector('link[rel="canonical"]')?.getAttribute('href') ||
    doc.querySelector('meta[property="og:url"]')?.getAttribute('content') ||
    ''
  );
}

function extractPageDate(doc: Document): string {
  const metaSelectors = [
    'meta[property="article:published_time"]',
    'meta[property="og:article:published_time"]',
    'meta[name="date"]',
    'meta[name="DC.date"]',
    'meta[itemprop="datePublished"]',
  ];
  for (const sel of metaSelectors) {
    const val = doc.querySelector(sel)?.getAttribute('content')?.trim();
    if (val) return val;
  }

  const timeEl = doc.querySelector('time[datetime]');
  if (timeEl) {
    const dt = timeEl.getAttribute('datetime')?.trim();
    if (dt) return dt;
    const text = timeEl.textContent?.trim();
    if (text) return text;
  }

  const schemaEl = doc.querySelector('[itemprop="datePublished"]');
  if (schemaEl) {
    const val = (schemaEl.getAttribute('content') || schemaEl.textContent || '').trim();
    if (val) return val;
  }

  const DATE_PATTERN = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b|\b\d{4}[-/]\d{2}[-/]\d{2}\b/;
  const articleArea =
    doc.querySelector('article') ||
    doc.querySelector('[class*="article-content"]') ||
    doc.querySelector('[class*="post-content"]') ||
    doc.querySelector('main') ||
    doc.body;

  const candidates = articleArea.querySelectorAll(
    'span, div, p, time, [class*="date"], [class*="time"], [class*="publish"]',
  );
  for (const el of candidates) {
    const isLeaf = el.children.length === 0;
    const text = (el.textContent || '').trim();
    if (isLeaf && text.length > 0 && text.length < 60 && DATE_PATTERN.test(text)) {
      return text;
    }
  }

  return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// 9. Main pipeline
// ---------------------------------------------------------------------------

function extractFromHtml(html: string, filename: string): string {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const pageTitle = extractPageTitle(doc);
  const pageUrl = extractCanonicalUrl(doc);
  const pageDate = extractPageDate(doc);

  const contentEl = findContentElement(doc);
  if (!contentEl) {
    return `<!-- No content element found in ${filename} -->`;
  }

  console.log(`  Content element: <${contentEl.tagName.toLowerCase()} class="${contentEl.className?.substring?.(0, 40) || ''}">`);

  const clone = contentEl.cloneNode(true) as Element;

  sanitizeEmailHtml(clone);

  const td = createEmailTurndown();
  let markdown = td.turndown(clone.innerHTML);

  markdown = cleanMarkdownLinks(markdown);
  markdown = cleanMarkdownContent(markdown);
  markdown = convertToReferenceLinks(markdown);
  markdown = cleanAfterReferenceConversion(markdown);
  markdown = removeUnusedReferences(markdown);
  markdown = renumberReferences(markdown);

  const header = `# ${pageTitle}\n${pageUrl}\n${pageDate}\n\n`;
  return header + markdown;
}

// ---------------------------------------------------------------------------
// 9. CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const testDir = resolve(__dirname);
  const outputDir = join(testDir, 'output');
  mkdirSync(outputDir, { recursive: true });

  const filter = process.argv[2]; // optional: "reuters", "financial_times", etc.

  const htmlFiles = readdirSync(testDir)
    .filter(f => f.endsWith('.html'))
    .filter(f => !filter || f.replace('.html', '').includes(filter));

  if (htmlFiles.length === 0) {
    console.log('No matching HTML files found.');
    return;
  }

  for (const file of htmlFiles) {
    const inputPath = join(testDir, file);
    const outputPath = join(outputDir, file.replace('.html', '.md'));

    console.log(`\nProcessing: ${file}`);
    const html = readFileSync(inputPath, 'utf-8');
    const markdown = extractFromHtml(html, file);

    writeFileSync(outputPath, markdown, 'utf-8');
    console.log(`  → ${outputPath} (${markdown.length} chars, ${markdown.split('\n').length} lines)`);
  }

  console.log('\nDone.');
}

main();
