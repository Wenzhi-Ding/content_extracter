import type { FileId, UserConfig } from './types';

export interface ExtractCurrentTabMessage {
  type: 'EXTRACT_CURRENT_TAB';
}

export interface DeleteFileMessage {
  type: 'DELETE_FILE';
  fileId: FileId;
}

export interface ClearAllFilesMessage {
  type: 'CLEAR_ALL_FILES';
}

export interface GetFilesMessage {
  type: 'GET_FILES';
}

export interface GetConfigMessage {
  type: 'GET_CONFIG';
}

export interface MergeAllFilesMessage {
  type: 'MERGE_ALL_FILES';
}

export interface SaveConfigMessage {
  type: 'SAVE_CONFIG';
  config: Partial<UserConfig>;
}

export interface CrawlLinksMessage {
  type: 'CRAWL_LINKS';
  fileId: FileId;
  urls: string[];
}

export type ServiceWorkerMessage =
  | ExtractCurrentTabMessage
  | DeleteFileMessage
  | ClearAllFilesMessage
  | GetFilesMessage
  | GetConfigMessage
  | MergeAllFilesMessage
  | SaveConfigMessage
  | CrawlLinksMessage;

export interface FilesUpdatedEvent {
  type: 'FILES_UPDATED';
}

export interface CrawlProgressEvent {
  type: 'CRAWL_PROGRESS';
  fileId: FileId;
  completed: number;
  total: number;
  currentUrl: string;
}

export interface CrawlCompleteEvent {
  type: 'CRAWL_COMPLETE';
  fileId: FileId;
}

export type BroadcastEvent =
  | FilesUpdatedEvent
  | CrawlProgressEvent
  | CrawlCompleteEvent;
