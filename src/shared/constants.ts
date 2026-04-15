import type { UserConfig } from './types';

export const EXTENSION_NAME = 'Content Extractor';

export const EXTENSION_VERSION = '1.0.0';

export const DEFAULT_CONFIG: UserConfig = {
  maxLinkDepth: 1,
  maxConcurrentTabs: 3,
  autoFollowLinks: false,
};

export const STORAGE_KEYS = {
  FILES: 'content_extractor_files',
  CONFIG: 'content_extractor_config',
} as const;
