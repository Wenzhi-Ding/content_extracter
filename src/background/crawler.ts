import { getFiles, updateFile } from './storage';
import type { BroadcastEvent } from '../shared/messages';
import type { ExtractionResult } from '../shared/types';

const TAB_LOAD_TIMEOUT_MS = 20000;
const INTER_TAB_DELAY_MS = 1500;

function waitForTabLoad(tabId: number, timeoutMs = TAB_LOAD_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`Tab ${tabId} load timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    function listener(updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function extractFromTab(tabId: number): Promise<ExtractionResult> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content-script.js'],
  });

  const response = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT' });
  if (response.type === 'EXTRACTION_ERROR') {
    throw new Error(response.error);
  }
  return response.result as ExtractionResult;
}

async function crawlSingleUrl(url: string): Promise<ExtractionResult> {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForTabLoad(tab.id!);
    const result = await extractFromTab(tab.id!);
    return result;
  } finally {
    try { await chrome.tabs.remove(tab.id!); } catch { /* tab may already be closed */ }
  }
}

function formatCrawledArticle(result: ExtractionResult, url: string): string {
  const divider = '\n\n---\n\n';
  const header = `## ${result.title || url}\n`;
  return divider + header + '\n' + result.markdown;
}

export async function crawlLinksForFile(
  fileId: string,
  urls: string[],
  maxConcurrent: number,
  broadcast: (event: BroadcastEvent) => void,
): Promise<void> {
  if (urls.length === 0) return;

  const total = urls.length;
  let completed = 0;
  const appendedSections: string[] = [];

  const queue = [...urls];

  async function processNext(): Promise<void> {
    while (queue.length > 0) {
      const url = queue.shift()!;
      broadcast({
        type: 'CRAWL_PROGRESS',
        fileId,
        completed,
        total,
        currentUrl: url,
      });

      try {
        console.log(`[ContentExtractor:Crawler] Crawling: ${url}`);
        const result = await crawlSingleUrl(url);
        appendedSections.push(formatCrawledArticle(result, url));
        console.log(`[ContentExtractor:Crawler] Done: ${url} (${result.markdown.length} chars)`);
      } catch (err) {
        console.error(`[ContentExtractor:Crawler] Failed: ${url}`, err);
        appendedSections.push(
          `\n\n---\n\n## ⚠ 提取失败: ${url}\n\n${err instanceof Error ? err.message : String(err)}`
        );
      }

      completed++;

      if (queue.length > 0) {
        await new Promise(r => setTimeout(r, INTER_TAB_DELAY_MS));
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(maxConcurrent, urls.length) },
    () => processNext(),
  );
  await Promise.all(workers);

  const files = await getFiles();
  const parentFile = files.find(f => f.id === fileId);
  if (!parentFile) return;

  const updatedMarkdown = parentFile.markdown + appendedSections.join('');
  await updateFile(fileId, { markdown: updatedMarkdown });

  broadcast({ type: 'CRAWL_COMPLETE', fileId });
  broadcast({ type: 'FILES_UPDATED' });
  console.log(`[ContentExtractor:Crawler] All ${total} links crawled for file ${fileId}`);
}

export function isCaixinArticleUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith('.caixin.com') || parsed.hostname === 'caixin.com';
  } catch {
    return false;
  }
}

export function filterCrawlableLinks(urls: Array<{ url: string }>): string[] {
  return urls
    .filter(link => isCaixinArticleUrl(link.url))
    .map(link => link.url);
}
