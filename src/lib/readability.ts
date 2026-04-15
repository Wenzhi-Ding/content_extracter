import { Readability } from '@mozilla/readability';

export interface ReadabilityResult {
  title: string;
  content: string;
  textContent: string;
  length: number;
  excerpt: string;
  siteName: string | null;
}

export function extractReadable(doc: Document): ReadabilityResult | null {
  const reader = new Readability(doc, {
    charThreshold: 0,
  });
  return reader.parse();
}

export function cloneDocumentForReadability(): Document {
  return document.cloneNode(true) as Document;
}
