/**
 * Standalone injectable API for Content Extractor.
 *
 * When this script is injected into any web page (e.g. via chrome.scripting.executeScript
 * or Kimi WebBridge evaluate), it exposes a global object:
 *
 *   window.__contentExtractor = {
 *     extract: () => Promise<ExtractionResult>,
 *     version: string,
 *   }
 *
 * ExtractionResult matches the extension's internal ExtractionResult type.
 */
import { extractReadable, cloneDocumentForReadability } from '../lib/readability';
import { htmlToMarkdown } from '../lib/turndown';
import { findContentElement, detectSiteType } from '../content/selectors';
import { cleanUrl, shouldKeepLink } from '../shared/link-cleaner';
import type { ExtractedLink, ExtractionResult, SiteType } from '../shared/types';

import {
  sanitizeEmailHtml,
  sanitizeCaixinHtml,
  sanitizeKimiHtml,
  clickCaixinLoadFullText,
} from '../content/sanitizers';

import {
  cleanMarkdownLinks,
  cleanMarkdownContent,
  convertToReferenceLinks,
  cleanAfterReferenceConversion,
  removeUnusedReferences,
  renumberReferences,
} from '../content/markdown-pipeline';

import { buildTitle, extractArticleDate } from '../content/metadata';

const API_VERSION = '1.1.0';

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

async function extractPageContent(): Promise<ExtractionResult> {
  const hostname = window.location.hostname;
  const siteType = detectSiteType(hostname);
  const sourceUrl = window.location.href;

  console.log('[ContentExtractor:API] Extracting from', hostname, '| siteType:', siteType);

  if (siteType === 'caixin') {
    await clickCaixinLoadFullText();
  }

  const targetElement = findContentElement(hostname);
  console.log(
    '[ContentExtractor:API] targetElement:',
    targetElement
      ? `<${targetElement.tagName} id="${targetElement.id}" class="${targetElement.className?.substring(0, 40)}">`
      : 'null',
  );

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
    } else if (siteType === 'kimi') {
      const sources = sanitizeKimiHtml(clonedTarget);
      rawTitle = document.title;
      content = clonedTarget.innerHTML;
      contentElement = targetElement;
      (contentElement as any).__kimiSources = sources;
    } else {
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
  let markdown = '';
  try {
    if (siteType === 'outlook') {
      // Outlook emails: prefer innerText to avoid CSS leakage from email HTML.
      markdown = (contentElement as HTMLElement).innerText ?? contentElement.textContent ?? '';
    } else {
      // Strip style/script tags at string level as a safety net before parsing.
      let cleanedHtml = content
        .replace(/\u003cstyle[^\u003e]*\u003e[\s\S]*?\u003c\/style\u003e/gi, '')
        .replace(/\u003cscript[^\u003e]*\u003e[\s\S]*?\u003c\/script\u003e/gi, '');
      // Normalize HTML through DOMParser to avoid Turndown crashes on malformed markup.
      const parser = new DOMParser();
      const parsedDoc = parser.parseFromString(cleanedHtml, 'text/html');
      const normalizedHtml = parsedDoc.body.innerHTML;
      markdown = htmlToMarkdown(normalizedHtml, isEmail);
    }
  } catch (tdError) {
    console.warn('[ContentExtractor:API] Turndown failed, falling back to textContent:', tdError);
    markdown = contentElement.textContent ?? '';
  }
  markdown = cleanMarkdownLinks(markdown);
  markdown = cleanMarkdownContent(markdown);
  markdown = convertToReferenceLinks(markdown);
  markdown = cleanAfterReferenceConversion(markdown);
  markdown = removeUnusedReferences(markdown);
  markdown = renumberReferences(markdown);

  const kimiSources = (contentElement as any).__kimiSources as string[] | undefined;
  if (kimiSources && kimiSources.length > 0) {
    markdown += '\n\n---\n\n**引用来源：**\n\n';
    for (const source of kimiSources) {
      markdown += `- ${source}\n`;
    }
  }

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

function installApi() {
  const api = {
    version: API_VERSION,
    extract: extractPageContent,
  };

  (window as any).__contentExtractor = api;

  // Also dispatch a custom event so external callers can detect readiness.
  window.dispatchEvent(new CustomEvent('contentExtractorReady', { detail: { version: API_VERSION } }));

  console.log('[ContentExtractor:API] Installed window.__contentExtractor v' + API_VERSION);
}

installApi();
