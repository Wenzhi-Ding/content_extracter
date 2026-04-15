import { getFiles, addFile, deleteFile, clearFiles, getConfig, saveConfig, saveFiles } from './storage';
import { crawlLinksForFile, filterCrawlableLinks } from './crawler';
import type { ServiceWorkerMessage, BroadcastEvent } from '../shared/messages';
import type { CapturedFile, ExtractionResult } from '../shared/types';
import { createMergedFile } from '../shared/merge-files';

console.log('[ContentExtractor:SW] Service worker loaded');

function broadcast(event: BroadcastEvent): void {
  chrome.runtime.sendMessage(event).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const msg = message as ServiceWorkerMessage;
  console.log('[ContentExtractor:SW] Received message:', msg.type);

  (async () => {
    try {
      switch (msg.type) {
        case 'EXTRACT_CURRENT_TAB': {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          console.log('[ContentExtractor:SW] Active tab:', tab?.id, tab?.url);
          if (!tab.id) {
            throw new Error('No active tab found');
          }

          console.log('[ContentExtractor:SW] Injecting content script...');
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content-script.js'],
          });
          console.log('[ContentExtractor:SW] Content script injected, sending EXTRACT...');

          const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT' });
          console.log('[ContentExtractor:SW] Content script response:', response);

          if (response.type === 'EXTRACTION_ERROR') {
            throw new Error(response.error);
          }

          const extractionResult = response.result as ExtractionResult;

          const capturedFile: CapturedFile = {
            id: crypto.randomUUID(),
            title: extractionResult.title,
            sourceUrl: extractionResult.sourceUrl,
            capturedAt: new Date().toISOString(),
            markdown: extractionResult.markdown,
            links: extractionResult.links,
            depth: 0,
            siteType: extractionResult.siteType,
            sender: extractionResult.sender,
            emailSubject: extractionResult.emailSubject,
            emailDate: extractionResult.emailDate,
            pageDate: extractionResult.pageDate,
          };

          await addFile(capturedFile);
          broadcast({ type: 'FILES_UPDATED' });
          console.log('[ContentExtractor:SW] File saved:', capturedFile.title);

          const isEmail = capturedFile.siteType === 'outlook' || capturedFile.siteType === 'gmail';
          if (isEmail && capturedFile.links.length > 0) {
            const crawlableUrls = filterCrawlableLinks(capturedFile.links);
            if (crawlableUrls.length > 0) {
              const config = await getConfig();
              console.log(`[ContentExtractor:SW] Auto-crawling ${crawlableUrls.length} Caixin links`);
              crawlLinksForFile(
                capturedFile.id,
                crawlableUrls,
                config.maxConcurrentTabs,
                broadcast,
              ).catch(err => console.error('[ContentExtractor:SW] Auto-crawl error:', err));
            }
          }

          sendResponse({ success: true, data: capturedFile });
          break;
        }

        case 'GET_FILES': {
          const files = await getFiles();
          sendResponse({ success: true, data: files });
          break;
        }

        case 'GET_CONFIG': {
          const config = await getConfig();
          sendResponse({ success: true, data: config });
          break;
        }

        case 'MERGE_ALL_FILES': {
          const files = await getFiles();

          if (files.length === 0) {
            sendResponse({ success: false, error: 'No files to merge' });
            break;
          }

          const mergedFile = createMergedFile(files);
          await saveFiles([mergedFile]);
          broadcast({ type: 'FILES_UPDATED' });
          sendResponse({ success: true, data: mergedFile });
          break;
        }

        case 'SAVE_CONFIG': {
          const config = await saveConfig(msg.config);
          sendResponse({ success: true, data: config });
          break;
        }

        case 'DELETE_FILE': {
          await deleteFile(msg.fileId);
          broadcast({ type: 'FILES_UPDATED' });
          sendResponse({ success: true });
          break;
        }

        case 'CLEAR_ALL_FILES': {
          await clearFiles();
          broadcast({ type: 'FILES_UPDATED' });
          sendResponse({ success: true });
          break;
        }

        case 'CRAWL_LINKS': {
          const config = await getConfig();
          console.log(`[ContentExtractor:SW] Manual crawl: ${msg.urls.length} links for file ${msg.fileId}`);
          crawlLinksForFile(
            msg.fileId,
            msg.urls,
            config.maxConcurrentTabs,
            broadcast,
          ).catch(err => console.error('[ContentExtractor:SW] Crawl error:', err));
          sendResponse({ success: true });
          break;
        }

        default: {
          console.warn('[ContentExtractor:SW] Unknown message type:', (message as Record<string, unknown>).type);
          break;
        }
      }
    } catch (error) {
      console.error('[ContentExtractor:SW] Error handling', msg.type, ':', error);
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  })();

  return true;
});
