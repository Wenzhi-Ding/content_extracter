import type { SiteType } from '../shared/types';

export interface SelectorStrategy {
  selector: string | null;
  description: string;
}

const OUTLOOK_STRATEGIES: SelectorStrategy[] = [
  { selector: '[id^="UniqueMessageBody"]', description: 'Outlook message body by ID prefix' },
  { selector: '[aria-label="邮件正文"]', description: 'Outlook message body (Chinese UI)' },
  { selector: '[aria-label="Message body"]', description: 'Outlook message body (English UI)' },
  { selector: '[role="document"][aria-label]', description: 'Outlook reading pane document role' },
  { selector: '[class^="rps_"]', description: 'Outlook email body container (rps_ prefixed class)' },
];

const GMAIL_STRATEGIES: SelectorStrategy[] = [
  { selector: '.a3s.aiL', description: 'Gmail message body' },
  { selector: '[role="main"] .gs', description: 'Gmail conversation view' },
];

const CAIXIN_STRATEGIES: SelectorStrategy[] = [
  { selector: '#Main_Content_Val', description: 'Caixin article body' },
  { selector: '.text.have_anchor_share', description: 'Caixin article text container' },
];

const DEFAULT_STRATEGIES: SelectorStrategy[] = [
  { selector: 'article', description: 'HTML5 article element' },
  { selector: '[role="main"]', description: 'Main landmark role' },
  { selector: 'main', description: 'HTML5 main element' },
  { selector: '.node__content', description: 'Drupal node content' },
  { selector: '.post-content', description: 'Common post content class' },
  { selector: null, description: 'Full page Readability' },
];

function isOutlookHost(hostname: string): boolean {
  return hostname.includes('outlook.office') ||
    hostname.includes('outlook.live') ||
    hostname.includes('outlook.office365') ||
    hostname.includes('outlook.cloud.microsoft');
}

function isCaixinHost(hostname: string): boolean {
  return hostname.endsWith('.caixin.com') || hostname === 'caixin.com';
}

function getStrategies(hostname: string): SelectorStrategy[] {
  if (isOutlookHost(hostname)) {
    return OUTLOOK_STRATEGIES;
  }
  if (hostname === 'mail.google.com') {
    return GMAIL_STRATEGIES;
  }
  if (isCaixinHost(hostname)) {
    return CAIXIN_STRATEGIES;
  }
  return DEFAULT_STRATEGIES;
}

export function findContentElement(hostname: string): Element | null {
  const strategies = getStrategies(hostname);
  
  for (const strategy of strategies) {
    if (strategy.selector === null) {
      return null;
    }
    
    const element = document.querySelector(strategy.selector);
    if (element) {
      return element;
    }
  }
  
  return null;
}

export function detectSiteType(hostname: string): SiteType {
  if (isOutlookHost(hostname)) {
    return 'outlook';
  }
  
  if (hostname === 'mail.google.com') {
    return 'gmail';
  }

  if (isCaixinHost(hostname)) {
    return 'caixin';
  }
  
  return 'generic';
}
