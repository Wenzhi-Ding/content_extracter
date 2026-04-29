export type FileId = string;

export type SiteType = 'outlook' | 'gmail' | 'caixin' | 'kimi' | 'generic';

export interface ExtractedLink {
  url: string;
  text: string;
  crawled: boolean;
}

export interface CapturedFile {
  id: FileId;
  title: string;
  sourceUrl: string;
  capturedAt: string;
  markdown: string;
  links: ExtractedLink[];
  depth: number;
  siteType: SiteType;
  sender?: string;
  emailSubject?: string;
  emailDate?: string;
  pageDate?: string;
  isMerged?: boolean;
  mergedPageCount?: number;
}

export interface UserConfig {
  maxConcurrentTabs: number;
}

export interface ExtractionResult {
  title: string;
  markdown: string;
  sourceUrl: string;
  links: ExtractedLink[];
  siteType: SiteType;
  sender?: string;
  emailSubject?: string;
  emailDate?: string;
  pageDate?: string;
}
