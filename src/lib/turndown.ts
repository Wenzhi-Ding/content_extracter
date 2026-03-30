import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { shouldKeepLink } from '../content/link-cleaner';

let webInstance: TurndownService | null = null;

const TRACKING_IMAGE_URL_PATTERNS = [
  /\.gif(\?|$)/i,
  /tracking/i,
  /pixel/i,
  /beacon/i,
  /open\.\w+\.com/i,
  /sailthru\.com/i,
  /doubleclick/i,
  /analytics/i,
  /sli\.reutersmedia\.net/i,
  /movable-ink/i,
  /movableink/i,
  /liadm\.com/i,
  /li\.mail\.liadm\.com/i,
  /adchoices/i,
  /aboutads\.info/i,
  /privacy-?icon/i,
  /adsymptotic\.com/i,
  /email-?open/i,
  /\.list-manage\.com\/track/i,
  /mailchimp\.com.*\/track/i,
  /e\.newsletters\./i,
  /newslink\.reuters\.com\/img/i,
  /link\.foreignaffairs\.com\/img/i,
  /mapcdn\.ft\.com.*\.gif/i,
  /mapcdn\.ft\.com.*\/open/i,
];

const SOCIAL_IMAGE_PATTERNS = [
  /facebook.*icon/i,
  /twitter.*icon/i,
  /instagram.*icon/i,
  /linkedin.*icon/i,
  /youtube.*icon/i,
  /x\.com.*icon/i,
  /social.*icon/i,
  /social[-_]?media/i,
  /icon[-_]?(fb|tw|ig|li|yt|x)\b/i,
  /\/(fb|twitter|instagram|linkedin|youtube|x)[-_.]*(icon|logo|badge)/i,
  /\/ico-social/i,
];

const JUNK_IMAGE_ALT_PATTERNS = [
  /^liveintent/i,
  /liveintent\s*logo/i,
  /^adchoices/i,
  /adchoices\s*logo/i,
  /^powered\s*by\s*(zeta|liveintent|sailthru)/i,
  /^download\s*the\s+\w+\s+app/i,
];

function isTrackingOrJunkImage(node: HTMLElement): boolean {
  const src = node.getAttribute('src') || '';
  const alt = (node.getAttribute('alt') || '').trim();
  const title = (node.getAttribute('title') || '').trim();
  const attrWidth = parseInt(node.getAttribute('width') || '', 10);
  const attrHeight = parseInt(node.getAttribute('height') || '', 10);
  const hasExplicitSize = !isNaN(attrWidth) && !isNaN(attrHeight);

  if (hasExplicitSize && attrWidth <= 3 && attrHeight <= 3) return true;

  const isTrackingUrl = TRACKING_IMAGE_URL_PATTERNS.some(p => p.test(src));
  if (isTrackingUrl && !alt) return true;
  if (/movable-ink|movableink|liadm\.com|sailthru\.com/i.test(src)) return true;
  if (!alt && !title && isTrackingUrl) return true;
  if (alt && JUNK_IMAGE_ALT_PATTERNS.some(p => p.test(alt))) return true;
  if (SOCIAL_IMAGE_PATTERNS.some(p => p.test(src))) return true;
  if (SOCIAL_IMAGE_PATTERNS.some(p => p.test(alt))) return true;

  return false;
}

function createBase(): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
  });

  td.addRule('removeTrackingImages', {
    filter: (node) => {
      if (node.nodeName !== 'IMG') return false;
      return isTrackingOrJunkImage(node as HTMLElement);
    },
    replacement: () => '',
  });

  return td;
}

function getWebTurndown(): TurndownService {
  if (!webInstance) {
    webInstance = createBase();
    webInstance.use(gfm);
    webInstance.remove(['script', 'style', 'nav', 'footer', 'header']);

    webInstance.addRule('removeImageOnlyLinks', {
      filter: (node) => {
        if (node.nodeName !== 'A') return false;
        const el = node as HTMLAnchorElement;
        const text = el.textContent?.trim() || '';
        if (text) return false;
        const hasImg = el.querySelector('img');
        if (!hasImg) return false;
        const href = el.href || '';
        if (!href || href === '#' || href.startsWith('javascript:')) return true;
        return false;
      },
      replacement: () => '',
    });
  }
  return webInstance;
}

export function createEmailTurndown(): TurndownService {
  const td = createBase();
  td.remove(['script', 'style']);

  td.addRule('emailLayoutTables', {
    filter: (node) => {
      if (node.nodeName !== 'TABLE') return false;
      const role = node.getAttribute('role');
      return role === 'presentation';
    },
    replacement: (_content, node) => {
      const inner = (node as HTMLElement).innerHTML || '';
      const nested = createEmailTurndown();
      return nested.turndown(inner) + '\n\n';
    },
  });

  td.addRule('removeJunkLinks', {
    filter: (node) => {
      if (node.nodeName !== 'A') return false;
      const href = node.getAttribute('href') || '';
      const text = (node.textContent || '').trim();
      return !shouldKeepLink(href, text);
    },
    replacement: (_content, node) => {
      return ((node as HTMLElement).textContent || '').trim();
    },
  });

  td.addRule('removeEmptyLinks', {
    filter: (node) => {
      if (node.nodeName !== 'A') return false;
      const text = (node.textContent || '').trim();
      if (text) return false;
      return node.children.length === 0 || !(node as HTMLElement).innerHTML?.trim();
    },
    replacement: () => '',
  });

  return td;
}

export function htmlToMarkdown(html: string, isEmail = false): string {
  const td = isEmail ? createEmailTurndown() : getWebTurndown();
  return td.turndown(html);
}
