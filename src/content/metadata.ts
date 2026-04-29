/**
 * Metadata extraction for different site types.
 * Extracts sender, subject, date from the page DOM.
 */
import type { SiteType } from '../shared/types';

export interface EmailMeta {
  subject: string | null;
  date: string | null;
  sender: string | null;
}

export interface TitleResult {
  title: string;
  sender?: string;
  emailSubject?: string;
  emailDate?: string;
}

// --- Outlook ---

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

// --- Gmail ---

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

// --- Generic article date ---

export function extractArticleDate(): string | null {
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

// --- Title builders ---

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

function buildKimiTitle(fallbackTitle: string): TitleResult {
  const chatNameEl = document.querySelector('.chat-name');
  const chatName = chatNameEl?.textContent?.trim() || fallbackTitle;

  const date = extractArticleDate() ?? undefined;

  return { title: chatName, emailDate: date };
}

export function buildTitle(siteType: SiteType, fallbackTitle: string): TitleResult {
  let meta: EmailMeta = { subject: null, date: null, sender: null };

  if (siteType === 'outlook') {
    meta = extractOutlookMeta();
  } else if (siteType === 'gmail') {
    meta = extractGmailMeta();
  } else if (siteType === 'caixin') {
    return buildCaixinTitle(fallbackTitle);
  } else if (siteType === 'kimi') {
    return buildKimiTitle(fallbackTitle);
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
