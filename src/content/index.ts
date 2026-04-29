/**
 * Content script entry point.
 * Orchestrates site detection → HTML sanitization → Markdown conversion → post-processing.
 * Injected programmatically via chrome.scripting.executeScript (no declarative content scripts).
 */
import { extractReadable, cloneDocumentForReadability } from '../lib/readability';
import { htmlToMarkdown } from '../lib/turndown';
import { findContentElement, detectSiteType } from './selectors';
import { cleanUrl, shouldKeepLink } from '../shared/link-cleaner';
import type { ExtractedLink, ExtractionResult, SiteType } from '../shared/types';

import {
  sanitizeEmailHtml,
  sanitizeCaixinHtml,
  sanitizeKimiHtml,
  clickCaixinLoadFullText,
} from './sanitizers';

import {
  cleanMarkdownLinks,
  cleanMarkdownContent,
  convertToReferenceLinks,
  cleanAfterReferenceConversion,
  removeUnusedReferences,
  renumberReferences,
} from './markdown-pipeline';

import { buildTitle, extractArticleDate } from './metadata';

// --- Link extraction ---

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

// --- Main extraction pipeline ---

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
    } else if (siteType === 'kimi') {
      const sources = sanitizeKimiHtml(clonedTarget);
      rawTitle = document.title;
      content = clonedTarget.innerHTML;
      contentElement = targetElement;
      // Store sources for later appending
      (contentElement as any).__kimiSources = sources;
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

  // Append Kimi citation sources if available
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

// --- Chrome message listener ---

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
