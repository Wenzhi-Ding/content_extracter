import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { shouldKeepLink } from '../shared/link-cleaner';
import { isJunkImage, parseSizeAttr } from '../shared/image-patterns';

let webInstance: TurndownService | null = null;

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
      const el = node as HTMLElement;
      return isJunkImage({
        src: el.getAttribute('src') || '',
        alt: (el.getAttribute('alt') || '').trim(),
        title: (el.getAttribute('title') || '').trim(),
        width: parseSizeAttr(el.getAttribute('width') || ''),
        height: parseSizeAttr(el.getAttribute('height') || ''),
      });
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
