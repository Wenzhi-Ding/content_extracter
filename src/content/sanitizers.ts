/**
 * Site-specific HTML sanitization.
 * Each sanitizer cleans a cloned DOM element before Markdown conversion.
 */
import { isJunkImage, parseSizeAttr } from '../shared/image-patterns';
import { cleanUrl } from '../shared/link-cleaner';

// --- Email sanitization helpers ---

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

// --- Public sanitizers ---

export function sanitizeEmailHtml(container: Element): void {
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
    const imgEl = img as HTMLImageElement;
    if (isJunkImage({
      src: imgEl.src || imgEl.getAttribute('src') || '',
      alt: (imgEl.alt || '').trim(),
      title: (imgEl.title || '').trim(),
      width: parseSizeAttr(imgEl.getAttribute('width') || ''),
      height: parseSizeAttr(imgEl.getAttribute('height') || ''),
    })) {
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

export async function clickCaixinLoadFullText(): Promise<void> {
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

export function sanitizeCaixinHtml(container: Element): void {
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

export function sanitizeKimiHtml(container: Element): string[] {
  const removeSelectors = [
    '.segment-assistant-actions',
    '.segment-assistant-actions-content',
    '.segment-user-actions',
    '.simple-button',
    '.toolcall-title-container',
    '.toolcall-title-name',
    '.table-actions',
    '.table-actions-content',
    '.chat-action',
    'script',
    'style',
  ];

  for (const sel of removeSelectors) {
    container.querySelectorAll(sel).forEach(el => el.remove());
  }

  // Convert rag-tag citation markers to reference-style text
  // Kimi uses <a class="rag-tag" href="..."> or <div class="rag-tag" data-site-name="...">
  const ragTags = container.querySelectorAll('.rag-tag');
  const sources: string[] = [];
  for (const el of ragTags) {
    const siteName = el.getAttribute('data-site-name') || '';
    const href = el.getAttribute('href') || '';
    if (siteName && !sources.includes(siteName)) {
      sources.push(siteName);
    }
    if (href && href.startsWith('http')) {
      // <a class="rag-tag" href="..."> → keep as a real link
      const a = document.createElement('a');
      a.setAttribute('href', href);
      a.textContent = `[${siteName}]`;
      el.replaceWith(a);
    } else {
      // <div class="rag-tag"> → plain text marker
      const textNode = document.createTextNode(` [ref: ${siteName}]`);
      el.replaceWith(textNode);
    }
  }

  // Remove empty elements that might be left after removal
  const allElements = container.querySelectorAll('div, span');
  for (const el of allElements) {
    if (!el.parentElement) continue;
    const text = (el.textContent || '').trim();
    if (text === '' && el.children.length === 0) {
      el.remove();
    }
  }

  return sources;
}
