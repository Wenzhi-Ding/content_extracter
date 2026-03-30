import type { UserConfig } from './types';

export const EXTENSION_NAME = 'BrowserClaw';

export const EXTENSION_VERSION = '1.0.0';

export const DEFAULT_CONFIG: UserConfig = {
  maxLinkDepth: 1,
  maxConcurrentTabs: 3,
  autoFollowLinks: false,
};

export const STORAGE_KEYS = {
  FILES: 'browserclaw_files',
  CONFIG: 'browserclaw_config',
} as const;
