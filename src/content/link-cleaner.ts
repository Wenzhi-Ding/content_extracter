const SAFELINK_HOSTS = [
  'safelinks.protection.outlook.com',
];

const REDIRECT_HOSTS: Record<string, string> = {
  'www.google.com': 'q',
  'slack-redir.net': 'url',
  'l.facebook.com': 'u',
};

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_cid',
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid',
  'mc_cid', 'mc_eid',
  '_hsenc', '_hsmi', 'hsCtaTracking',
  'ref', 'ref_src', 'ref_url',
  'source', 'ust', 'usg',
  'sdata', 'reserved',
  'data',
  'mkt_tok',
  'trk', 'trkCampaign', 'trkInfo',
  'si', 'feature',
  'oly_enc_id', 'oly_anon_id',
  'vero_id', 'vero_conv',
  'wickedid',
  's_kwcid', 'ef_id',
  'epik',
  'lctg',
  'segmentid',
  'xnpe_tifc', 'xnpe_cmp',
  'cid',
]);

const BASE64_REDIRECT_HOSTS = new Set([
  'newslink.reuters.com',
  'link.foreignaffairs.com',
]);

function unwrapBase64Redirect(url: string, parsed: URL): string | null {
  if (!BASE64_REDIRECT_HOSTS.has(parsed.hostname)) return null;
  const pathType = parsed.pathname.split('/')[1];
  if (pathType !== 'click' && pathType !== 'external') return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 3) return null;

  const b64 = segments[2];
  try {
    const decoded = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
      return decoded;
    }
  } catch {
    // not valid base64
  }
  return null;
}

const JUNK_LINK_PATTERNS = [
  /^mailto:/i,
  /^tel:/i,
  /^javascript:/i,
  /^#/,
  /unsubscribe/i,
  /opt[\-_]?out/i,
  /manage[\-_]?preferences/i,
  /email[\-_]?preferences/i,
  /notification[\-_]?settings/i,
  /privacy[\-_]?policy/i,
  /terms[\-_]?(of[\-_]?service|and[\-_]?conditions|of[\-_]?use)/i,
  /cookie[\-_]?policy/i,
  /legal[\-_]?notice/i,
  /contact[\-_]?us/i,
  /help[\-_]?center/i,
  /support\..*\.com\/?$/i,
  /^https?:\/\/aka\.ms\//i,
  /\/about\?u=/i,
  /\/profile\?u=/i,
];

const JUNK_ANCHOR_PATTERNS = [
  /^unsubscribe$/i,
  /^opt[\s\-_]?out$/i,
  /^manage\s*(email\s*)?preferences$/i,
  /^view\s*(in|this\s*email\s*in)\s*(your\s*)?browser$/i,
  /^privacy\s*policy$/i,
  /^terms/i,
  /^legal/i,
  /^cookie/i,
  /^update\s*your\s*preferences$/i,
  /^click\s*here\s*to\s*unsubscribe$/i,
  /^why\s+did\s+I\s+get\s+this\??$/i,
  /^(here\.?)$/i,
];

function isSafeLink(hostname: string): boolean {
  return SAFELINK_HOSTS.some(h => hostname.endsWith(h));
}

function unwrapRedirect(url: string): string {
  try {
    const parsed = new URL(url);

    if (isSafeLink(parsed.hostname)) {
      const original = parsed.searchParams.get('url');
      if (original) {
        return unwrapRedirect(decodeURIComponent(original));
      }
    }

    const paramName = REDIRECT_HOSTS[parsed.hostname];
    if (paramName) {
      const original = parsed.searchParams.get(paramName);
      if (original) {
        return decodeURIComponent(original);
      }
    }

    const b64Result = unwrapBase64Redirect(url, parsed);
    if (b64Result) {
      return unwrapRedirect(b64Result);
    }
  } catch {
    return url;
  }
  return url;
}

function stripTrackingParams(url: string): string {
  try {
    const parsed = new URL(url);
    const keysToRemove: string[] = [];
    parsed.searchParams.forEach((_value, key) => {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        keysToRemove.push(key);
      }
    });
    keysToRemove.forEach(k => parsed.searchParams.delete(k));
    let cleaned = parsed.origin + parsed.pathname;
    const remaining = parsed.searchParams.toString();
    if (remaining) {
      cleaned += '?' + remaining;
    }
    if (parsed.hash) {
      cleaned += parsed.hash;
    }
    return cleaned;
  } catch {
    return url;
  }
}

function isJunkLink(url: string, anchorText: string): boolean {
  for (const pattern of JUNK_LINK_PATTERNS) {
    if (pattern.test(url)) {
      return true;
    }
  }
  const trimmed = anchorText.trim();
  if (trimmed) {
    for (const pattern of JUNK_ANCHOR_PATTERNS) {
      if (pattern.test(trimmed)) {
        return true;
      }
    }
  }
  return false;
}

export function cleanUrl(url: string): string {
  let cleaned = unwrapRedirect(url);
  cleaned = stripTrackingParams(cleaned);
  return cleaned;
}

export function shouldKeepLink(url: string, anchorText: string): boolean {
  return !isJunkLink(url, anchorText);
}
