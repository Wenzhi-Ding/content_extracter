/**
 * Markdown post-processing pipeline.
 * Pure string transformations — no DOM dependencies.
 */
import { cleanUrl, shouldKeepLink } from '../shared/link-cleaner';

export function cleanMarkdownLinks(markdown: string): string {
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

export function cleanMarkdownContent(markdown: string): string {
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
  if (IMAGE_EXTENSIONS.test(url)) return true;
  if (/^data:image\//i.test(url)) return true;
  return false;
}

export function convertToReferenceLinks(markdown: string): string {
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

export function cleanAfterReferenceConversion(markdown: string): string {
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

export function removeUnusedReferences(markdown: string): string {
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

export function renumberReferences(markdown: string): string {
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
