import { extractReadable, cloneDocumentForReadability } from '../lib/readability';
import { htmlToMarkdown } from '../lib/turndown';
import { findContentElement, detectSiteType } from './selectors';
import { cleanUrl, shouldKeepLink } from './link-cleaner';
import type { ExtractedLink, ExtractionResult, SiteType } from '../shared/types';

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
  /caution:?\s*external\s+email/i,
];

const TRACKING_IMAGE_PATTERNS = [
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

function isTrackingImage(img: HTMLImageElement): boolean {
  const src = img.src || img.getAttribute('src') || '';
  const alt = (img.alt || '').trim();
  const title = (img.title || '').trim();
  const attrWidth = parseInt(img.getAttribute('width') || '', 10);
  const attrHeight = parseInt(img.getAttribute('height') || '', 10);
  const hasExplicitSize = !isNaN(attrWidth) && !isNaN(attrHeight);

  if (hasExplicitSize && attrWidth <= 3 && attrHeight <= 3) return true;

  const isTrackingUrl = TRACKING_IMAGE_PATTERNS.some(p => p.test(src));
  if (isTrackingUrl && !alt) return true;
  if (/movable-ink|movableink|liadm\.com|sailthru\.com/i.test(src)) return true;
  if (!alt && !title && isTrackingUrl) return true;
  if (alt && JUNK_IMAGE_ALT_PATTERNS.some(p => p.test(alt))) return true;
  if (SOCIAL_IMAGE_PATTERNS.some(p => p.test(src))) return true;
  if (SOCIAL_IMAGE_PATTERNS.some(p => p.test(alt))) return true;

  return false;
}

function isBoilerplateNode(el: Element): boolean {
  const text = el.textContent || '';
  if (text.trim().length < 5) return false;

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

function isDecorationTable(table: Element): boolean {
  if (table.getAttribute('role') !== 'presentation') return false;

  const text = (table.textContent || '').trim();
  const contentLinks = table.querySelectorAll('a[href]');

  if (text.length === 0 && contentLinks.length === 0) return true;

  return false;
}

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

  const images = container.querySelectorAll('img');
  for (const img of images) {
    if (isTrackingImage(img as HTMLImageElement)) {
      const parent = img.parentElement;
      img.remove();
      if (parent?.tagName === 'A' && !parent.textContent?.trim()) {
        parent.remove();
      }
    }
  }

  const tables = Array.from(container.querySelectorAll('table[role="presentation"]'));
  for (let i = tables.length - 1; i >= 0; i--) {
    if (isDecorationTable(tables[i])) {
      tables[i].remove();
    }
  }

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

    if (children.length === 0 && text === '') {
      el.remove();
    }
  }

  // Unwrap safelinks and fix broken URLs in <a> attributes
  const links = container.querySelectorAll('a[href]');
  for (const a of links) {
    let href = a.getAttribute('href') || '';

    href = href.replace(/^https?:\/\/outlook\.live\.com(?=https?:\/\/)/, '');

    if (href.startsWith('null') && href.includes('@') && !href.startsWith('nullhttp')) {
      href = 'mailto:' + href.substring(4);
    }

    if (href) {
      const cleaned = cleanUrl(href);
      a.setAttribute('href', cleaned);
    }

    const title = a.getAttribute('title') || '';
    if (/由\s*Outlook\s*保护/.test(title) || /单击或点击/.test(title)) {
      a.removeAttribute('title');
    }

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

function extractLinks(container: Element): ExtractedLink[] {
  const links = container.querySelectorAll('a[href]');
  const seen = new Set<string>();
  const extracted: ExtractedLink[] = [];
  
  links.forEach((anchor) => {
    const el = anchor as HTMLAnchorElement;
    const rawHref = el.href;
    
    if (!rawHref.startsWith('http://') && !rawHref.startsWith('https://')) {
      return;
    }

    const anchorText = anchor.textContent?.trim() || '';

    if (!shouldKeepLink(rawHref, anchorText)) {
      return;
    }

    const cleanedUrl = cleanUrl(rawHref);

    if (seen.has(cleanedUrl)) {
      return;
    }
    
    seen.add(cleanedUrl);
    extracted.push({
      url: cleanedUrl,
      text: anchorText,
      crawled: false,
    });
  });
  
  return extracted;
}

interface EmailMeta {
  subject: string | null;
  date: string | null;
  sender: string | null;
}

function extractOutlookMeta(): EmailMeta {
  let subject: string | null = null;
  let date: string | null = null;
  let sender: string | null = null;

  const readingPane = document.querySelector('[data-app-section="ReadingPane"], [role="main"]');
  const scope = readingPane || document;

  const subjectSpan = scope.querySelector('span.JdFsz[title]');
  if (subjectSpan) {
    const t = subjectSpan.getAttribute('title') || '';
    if (t.length > 1) subject = t;
  }

  if (!subject) {
    const allElements = scope.querySelectorAll('[id]');
    for (const el of allElements) {
      const id = el.id;
      if (!id.endsWith('_SUBJECT')) continue;
      const span = el.querySelector('span[title]');
      if (span) {
        const t = span.getAttribute('title') || '';
        if (t.length > 1) { subject = t; break; }
      }
      const text = el.textContent?.trim() || '';
      if (text.length > 1) { subject = text; break; }
    }
  }

  const dateEl = scope.querySelector('[data-testid="SentReceivedSavedTime"]');
  if (dateEl) {
    const rawDate = dateEl.textContent?.trim() || '';
    const dateMatch = rawDate.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (dateMatch) {
      const y = dateMatch[1];
      const m = dateMatch[2].padStart(2, '0');
      const d = dateMatch[3].padStart(2, '0');
      date = `${y}${m}${d}`;
    }
  }

  const senderSpan = scope.querySelector('span.OZZZK');
  if (senderSpan) {
    let text = senderSpan.textContent?.trim() || '';
    text = text.replace(/<[^>]*>/g, '').trim();
    text = text.replace(/\S+@\S+\.\S+/g, '').trim();
    if (text.length > 1) sender = text;
  }

  if (!sender) {
    const allElements = scope.querySelectorAll('[id]');
    for (const el of allElements) {
      if (!el.id.endsWith('_FROM')) continue;
      const ariaLabel = el.getAttribute('aria-label') || '';
      const labelMatch = ariaLabel.match(/^(?:From|发件人)[:\uff1a\s]\s*(.+)/i);
      if (labelMatch) {
        sender = labelMatch[1].trim();
        break;
      }
      const spans = el.querySelectorAll('span');
      for (const span of spans) {
        const text = span.textContent?.trim() || '';
        if (text && text.length > 1 && !text.includes('@') && !text.includes('.com')) {
          sender = text;
          break;
        }
      }
      if (sender) break;
    }
  }

  if (!subject) {
    const selectedItem = document.querySelector('[role="option"][aria-selected="true"]');
    if (selectedItem) {
      const spans = selectedItem.querySelectorAll('span[title]');
      for (const span of spans) {
        if (span.closest('button')) continue;
        const t = span.getAttribute('title') || '';
        if (t.length > 2 && !t.includes('@')) {
          subject = t;
          break;
        }
      }
      if (!subject) {
        const allSpans = selectedItem.querySelectorAll('span');
        for (const span of allSpans) {
          if (span.closest('button')) continue;
          if (span.children.length > 0) continue;
          const text = span.textContent?.trim() || '';
          if (text.length > 5 && !text.includes('@') && !/^\d/.test(text)) {
            subject = text;
            break;
          }
        }
      }
    }
  }

  console.log('[ContentExtractor:Content] Outlook meta:', { subject, date, sender });
  return { subject, date, sender };
}

function extractGmailMeta(): EmailMeta {
  const subjectEl = document.querySelector('h2[data-thread-perm-id]')
    ?? document.querySelector('div[role="main"] h2');
  const subject = subjectEl?.textContent?.trim() || null;

  let date: string | null = null;
  const dateEl = document.querySelector('span[data-tooltip]');
  if (dateEl) {
    date = dateEl.getAttribute('data-tooltip') || dateEl.textContent?.trim() || null;
  }

  let sender: string | null = null;
  const senderEl = document.querySelector('span.gD[email]');
  if (senderEl) {
    sender = senderEl.getAttribute('name') || senderEl.textContent?.trim() || null;
  }

  return { subject, date, sender };
}

interface TitleResult {
  title: string;
  sender?: string;
  emailSubject?: string;
  emailDate?: string;
}

function buildTitle(siteType: SiteType, fallbackTitle: string): TitleResult {
  let meta: EmailMeta = { subject: null, date: null, sender: null };

  if (siteType === 'outlook') {
    meta = extractOutlookMeta();
  } else if (siteType === 'gmail') {
    meta = extractGmailMeta();
  } else if (siteType === 'caixin') {
    return buildCaixinTitle(fallbackTitle);
  }

  if (siteType === 'generic') {
    return { title: fallbackTitle };
  }

  const parts: string[] = [];
  if (meta.sender) parts.push(meta.sender);
  let subjectText = meta.subject || fallbackTitle;
  const words = subjectText.split(/\s+/);
  if (words.length > 5) {
    subjectText = words.slice(0, 5).join(' ');
  }
  parts.push(subjectText);
  if (meta.date) parts.push(meta.date);

  return {
    title: parts.join('_'),
    sender: meta.sender || undefined,
    emailSubject: meta.subject || undefined,
    emailDate: meta.date || undefined,
  };
}

function buildCaixinTitle(fallbackTitle: string): TitleResult {
  const h1 = document.querySelector('#conTit h1');
  const title = h1?.textContent?.trim()?.replace(/\s+/g, ' ') || fallbackTitle;

  const authorEl = document.querySelector('.top-author');
  const sender = authorEl?.textContent?.trim() || undefined;

  const artInfo = document.querySelector('#artInfo');
  let date: string | undefined;
  if (artInfo) {
    const dateMatch = artInfo.textContent?.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (dateMatch) {
      date = `${dateMatch[1]}${dateMatch[2].padStart(2, '0')}${dateMatch[3].padStart(2, '0')}`;
    }
  }

  return { title, sender, emailDate: date };
}

function cleanMarkdownLinks(markdown: string): string {
  return markdown.replace(
    /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_match, text: string, url: string) => {
      let cleanedUrl = url;

      cleanedUrl = cleanedUrl.replace(/^https?:\/\/outlook\.live\.com(?=https?:\/\/)/, '');

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

  // PUA characters (U+E000–U+F8FF), zero-width chars, BOM, soft hyphens
  // Outlook injects PUA chars like U+E113 that create orphan bold markers
  cleaned = cleaned.replace(/[\u200B\u200C\u200D\uFEFF\u034F\u00AD\u00A0\uE000-\uF8FF]/g, function(ch) {
    if (ch === '\u00A0') return ' ';
    return '';
  });

  cleaned = cleaned.replace(/^\*{1,3}\s*$/gm, '');

  cleaned = cleaned.replace(/^.*©\s*\d{4}.*$/gm, '');
  cleaned = cleaned.replace(/^.*All\s*rights?\s*reserved.*$/gim, '');

  cleaned = cleaned.replace(/由\s*Outlook\s*保护[:：]?[^。]*[。]?/g, '');
  cleaned = cleaned.replace(/单击或点击以打开链接[。.]?/g, '');

  cleaned = cleaned.replace(/^!\[\]\([^)]+\)\s*$/gm, '');
  cleaned = cleaned.replace(/^\[!\[\]\[[^\]]*\]\]\([^)]+\)\s*$/gm, '');
  cleaned = cleaned.replace(/^!\[无配图\]\[[^\]]*\]\s*$/gm, '');

  cleaned = cleaned.replace(/^.*Sponsors?\s*(are)?\s*not\s*involved.*$/gim, '');
  cleaned = cleaned.replace(/^.*Advertise\s*with\s*us.*$/gim, '');

  cleaned = cleaned.replace(/^(REUTERS|AFP|AP|Getty\s*Images?)\/[^\n]*$/gm, '');

  cleaned = cleaned.replace(/^\[?View\s*(in\s*Browser|online|in\s*your\s*browser)\]?\s*(\([^)]*\)|\[[^\]]*\])?\s*$/gim, '');
  cleaned = cleaned.replace(/^邮件无法正常浏览.*$/gm, '');

  cleaned = cleaned.replace(/^.*This\s+email\s+includes\s+limited\s+tracking.*$/gim, '');
  cleaned = cleaned.replace(/^.*We\s+use\s+pixels\s+in\s+HTML\s+emails.*$/gim, '');
  cleaned = cleaned.replace(/^.*The\s+pixel\s+will\s+be\s+deleted.*$/gim, '');
  cleaned = cleaned.replace(/^.*See\s+our\s+cookie\s+policy\s+for\s+more.*$/gim, '');

  cleaned = cleaned.replace(/^.*This\s+email\s+(was\s+)?sent\s+(to|by)\b.*$/gim, '');

  cleaned = cleaned.replace(/^.*please\s+add\s+us\s+to\s+your.*$/gim, '');

  cleaned = cleaned.replace(/^.*Receiving\s+too\s+many\s+emails\?.*$/gim, '');

  cleaned = cleaned.replace(/^\s*Terms\s*&\s*Conditions\s*$/gim, '');

  cleaned = cleaned.replace(/^[A-Za-z\s.·,]+\d{5,6}\s*·\s*[A-Za-z]+\s*$/gm, '');
  cleaned = cleaned.replace(/^.+·.+·.+\d{5,6}.+$/gm, '');

  cleaned = cleaned.replace(/^.*why\s+did\s+I\s+get\s+this\?.*$/gim, '');
  cleaned = cleaned.replace(/^.*unsubscribe\s+from\s+this\s+list.*$/gim, '');
  cleaned = cleaned.replace(/^.*update\s+subscription\s+preferences.*$/gim, '');

  cleaned = cleaned.replace(/^This\s+newsletter\s+was\s+edited\s+by\s+.+$/gim, '');

  cleaned = cleaned.replace(/^Sponsored\s+by\s+\[.*$/gm, '');

  cleaned = cleaned.replace(/^Advertisement:?\s+.*$/gim, '');

  // Remove "CAUTION: External email" Outlook warning banner
  cleaned = cleaned.replace(/^CAUTION:?\s*External\s+email.*$/gim, '');

  // Remove newsletter date + "Read online" header: "April 08, 2026   |   [Read online][N]"
  cleaned = cleaned.replace(/^\w+\s+\d{1,2},?\s+\d{4}\s*\|.*$/gm, '');

  // Remove attachment blocks: "filename.ext / X.XX MB • File Type / [Download]"
  cleaned = cleaned.replace(/^.*\d+(\.\d+)?\s*(MB|KB|GB)\s*[•·]\s*\w+\s*(File|Document)\s*$/gim, '');
  cleaned = cleaned.replace(/^\[Download\]\[\d+\]\s*$/gim, '');
  cleaned = cleaned.replace(/^\[Download\]\s*$/gim, '');

  // Remove "Special thanks to our partners" heading
  cleaned = cleaned.replace(/^##?\s*Special\s+thanks\s+to\s+our\s+partners?:?\s*$/gim, '');

  // Remove "Over To You" newsletter engagement CTA section header
  cleaned = cleaned.replace(/^##?\s*\*{0,2}Over\s+To\s+You:?\s*\*{0,2}.*$/gim, '');

  // Remove standalone PDF filename lines (attachments)
  cleaned = cleaned.replace(/^.*\.pdf\s*$/gim, '');

  // Remove [Download](url) inline links (attachment buttons, before reference conversion)
  cleaned = cleaned.replace(/^\[Download\]\([^)]+\)\s*$/gim, '');

  cleaned = cleaned.replace(/^尚未订阅.*$/gm, '');
  cleaned = cleaned.replace(/^\[立即订阅\].*$/gm, '');
  cleaned = cleaned.replace(/^分享给好友.*$/gm, '');
  cleaned = cleaned.replace(/^\[打开网页版\].*$/gm, '');

  cleaned = cleaned.replace(/^\[?\*?\*?Read\s+it\s+free\*?\*?\]?\s*(\([^)]*\)|\[[^\]]*\])?\s*$/gim, '');

  cleaned = cleaned.replace(/^\|?\s*\|?\s*$/gm, '');

  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  cleaned = cleaned.trim();

  return cleaned;
}

const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|svg|webp|bmp|ico|avif|tiff?)(\?|#|$)/i;

function isImageUrl(url: string): boolean {
  // Check extension
  if (IMAGE_EXTENSIONS.test(url)) return true;
  // Common image CDN patterns without extension
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

  const refs = Array.from(urlToIndex.entries())
    .sort((a, b) => a[1] - b[1])
    .map(([url, idx]) => `[${idx}]: ${url}`)
    .join('\n');

  return body + '\n\n' + refs;
}

function cleanAfterReferenceConversion(markdown: string): string {
  let cleaned = markdown;

  cleaned = cleaned.replace(/^\[View\s*(in\s*Browser|online|in\s*your\s*browser)\]\[\d+\]\s*$/gim, '');
  cleaned = cleaned.replace(/^邮件无法正常浏览.*$/gm, '');
  cleaned = cleaned.replace(/^\[!\[[^\]]*\]\[\d+\]\]\[\d+\]\s*$/gm, '');

  // ![无配图]... leftover (unlikely but defensive)
  cleaned = cleaned.replace(/^!\[无配图\].*$/gm, '');

  // [Download][N] reference-style links (attachment buttons)
  cleaned = cleaned.replace(/^\[Download\]\[\d+\]\s*$/gim, '');

  // Partner / sponsor list items: "- [Name][N]. Description... Learn more: [Name][N]"
  cleaned = cleaned.replace(/^-   \[.*?\]\[\d+\][\.\s].*?Learn\s+more:.*$/gm, '');
  // Variant: "-   [Name][N][.][M] description..." (broken link artifacts)
  cleaned = cleaned.replace(/^-   \[.*?\]\[\d+\]\[\.\]\[\d+\].*$/gm, '');

  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.trim();

  return cleaned;
}

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
    return body.includes(`][${idx}]`);
  });

  return bodyLines.join('\n') + '\n\n' + usedRefs.join('\n');
}

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

  let alreadySequential = true;
  for (const [old, nw] of oldToNew) {
    if (old !== nw) { alreadySequential = false; break; }
  }
  if (alreadySequential) return markdown;

  let body = bodyLines.join('\n');
  for (const [old, nw] of oldToNew) {
    body = body.replaceAll(`][${old}]`, `][${nw}]`);
  }

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

async function clickCaixinLoadFullText(): Promise<void> {
  const allLinks = document.querySelectorAll('a');
  let loadMoreBtn: HTMLAnchorElement | null = null;
  for (const a of allLinks) {
    if (a.textContent?.trim() === '余下全文') {
      loadMoreBtn = a;
      break;
    }
  }
  if (!loadMoreBtn) {
    const allButtons = document.querySelectorAll('button, [role="button"]');
    for (const btn of allButtons) {
      if (btn.textContent?.trim() === '余下全文') {
        (btn as HTMLElement).click();
        await new Promise(r => setTimeout(r, 3000));
        return;
      }
    }
    return;
  }

  loadMoreBtn.click();
  await new Promise(r => setTimeout(r, 3000));
}

function sanitizeCaixinHtml(container: Element): void {
  const removeSelectors = [
    '#chargeWall',
    '#comment',
    '.pip_ad',
    '.pip_rel',
    '.pip_rel_en',
    '#questions_container',
    '.hot_questions',
    '.aitt',
    '.artTool',
    '.pc-aivoice',
    '.listner',
    'script',
    'style',
    '.media.article_media_pic',
    '.index_right_ad',
  ];

  for (const sel of removeSelectors) {
    container.querySelectorAll(sel).forEach(el => el.remove());
  }
}

function extractArticleDate(): string | null {
  const metaSelectors = [
    'meta[property="article:published_time"]',
    'meta[property="og:article:published_time"]',
    'meta[name="date"]',
    'meta[name="DC.date"]',
    'meta[itemprop="datePublished"]',
  ];
  for (const sel of metaSelectors) {
    const val = document.querySelector(sel)?.getAttribute('content')?.trim();
    if (val) return val;
  }

  const timeEl = document.querySelector('time[datetime]');
  if (timeEl) {
    const dt = timeEl.getAttribute('datetime')?.trim();
    if (dt) return dt;
    const text = timeEl.textContent?.trim();
    if (text) return text;
  }

  const schemaEl = document.querySelector('[itemprop="datePublished"]');
  if (schemaEl) {
    const val = (schemaEl.getAttribute('content') || schemaEl.textContent || '').trim();
    if (val) return val;
  }

  const DATE_PATTERN = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b|\b\d{4}[-/]\d{2}[-/]\d{2}\b/;
  const articleArea =
    document.querySelector('article') ||
    document.querySelector('[class*="article-content"]') ||
    document.querySelector('[class*="post-content"]') ||
    document.querySelector('main') ||
    document.body;

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

  return null;
}

async function extractPageContent(): Promise<ExtractionResult> {
  const hostname = window.location.hostname;
  const siteType = detectSiteType(hostname);
  const sourceUrl = window.location.href;

  console.log('[ContentExtractor:Content] Extracting from', hostname, '| siteType:', siteType);

  if (siteType === 'caixin') {
    await clickCaixinLoadFullText();
  }
  
  const targetElement = findContentElement(hostname);
  console.log('[ContentExtractor:Content] targetElement:', targetElement ? `<${targetElement.tagName} id="${targetElement.id}" class="${targetElement.className?.substring(0, 40)}">` : 'null');
  
  let rawTitle: string;
  let content: string;
  let contentElement: Element;
  
  if (targetElement) {
    const clonedTarget = targetElement.cloneNode(true) as Element;

    if (siteType === 'outlook' || siteType === 'gmail') {
      sanitizeEmailHtml(clonedTarget);
      rawTitle = document.title;
      content = clonedTarget.innerHTML;
      contentElement = targetElement;
    } else if (siteType === 'caixin') {
      sanitizeCaixinHtml(clonedTarget);
      rawTitle = document.title;
      content = clonedTarget.innerHTML;
      contentElement = targetElement;
    } else {
      // Generic site with identifiable content element (article/main/etc.)
      // Use the element's HTML directly — Readability already found the content for us.
      rawTitle = document.title;
      content = clonedTarget.innerHTML;
      contentElement = targetElement;
    }
  } else {
    const clonedDoc = cloneDocumentForReadability();
    const readable = extractReadable(clonedDoc);
    
    if (readable) {
      rawTitle = readable.title;
      content = readable.content;
      contentElement = document.body;
    } else {
      rawTitle = document.title;
      content = document.body.innerText;
      contentElement = document.body;
    }
  }
  
  const isEmail = siteType === 'outlook' || siteType === 'gmail';
  let markdown = htmlToMarkdown(content, isEmail);
  markdown = cleanMarkdownLinks(markdown);
  markdown = cleanMarkdownContent(markdown);
  markdown = convertToReferenceLinks(markdown);
  markdown = cleanAfterReferenceConversion(markdown);
  markdown = removeUnusedReferences(markdown);
  markdown = renumberReferences(markdown);

  const links = extractLinks(contentElement);
  const titleResult = buildTitle(siteType, rawTitle);
  const pageDate = siteType === 'generic' ? (extractArticleDate() ?? undefined) : undefined;

  return {
    title: titleResult.title,
    markdown,
    sourceUrl,
    links,
    siteType,
    sender: titleResult.sender,
    emailSubject: titleResult.emailSubject,
    emailDate: titleResult.emailDate,
    pageDate,
  };
}

console.log('[ContentExtractor:Content] Content script loaded on', window.location.hostname);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[ContentExtractor:Content] Received message:', message.type);
  if (message.type === 'EXTRACT') {
    extractPageContent()
      .then(result => {
        console.log('[ContentExtractor:Content] Extraction complete:', result.title, '| markdown length:', result.markdown.length, '| links:', result.links.length);
        sendResponse({ type: 'EXTRACTION_COMPLETE', result });
      })
      .catch(error => {
        console.error('[ContentExtractor:Content] Extraction error:', error);
        sendResponse({ 
          type: 'EXTRACTION_ERROR', 
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return true;
  }
});
