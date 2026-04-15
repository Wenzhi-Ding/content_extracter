import type { UserConfig } from './types';

export const DEFAULT_CONFIG: UserConfig = {
  maxConcurrentTabs: 3,
};

export const STORAGE_KEYS = {
  FILES: 'content_extractor_files',
  CONFIG: 'content_extractor_config',
} as const;
