import type { CapturedFile } from './types';

function getOriginalDate(file: CapturedFile): string | undefined {
  return file.emailDate || file.pageDate;
}

function getMergedDateSummary(files: CapturedFile[]): string | undefined {
  const dates = files
    .map(getOriginalDate)
    .filter((value): value is string => Boolean(value));

  if (dates.length === 0) {
    return undefined;
  }

  const uniqueDates = Array.from(new Set(dates));
  if (uniqueDates.length === 1) {
    return uniqueDates[0];
  }

  return `${uniqueDates[0]} → ${uniqueDates[uniqueDates.length - 1]}`;
}

function offsetReferences(markdown: string, offset: number): string {
  if (offset === 0) return markdown;

  let result = markdown.replace(/\[([^\]]*)\]\[(\d+)\]/g, (_match, text, num) => {
    return `[${text}][${Number(num) + offset}]`;
  });

  result = result.replace(/^\[(\d+)\]:\s/gm, (_match, num) => {
    return `[${Number(num) + offset}]: `;
  });

  return result;
}

function maxRefIndex(markdown: string): number {
  let max = 0;
  const matches = markdown.matchAll(/\[(\d+)\]:/g);

  for (const match of matches) {
    const index = Number(match[1]);
    if (index > max) {
      max = index;
    }
  }

  return max;
}

export function mergeFilesMarkdown(files: CapturedFile[]): string {
  const parts: string[] = [];
  let offset = 0;

  for (const file of files) {
    const header = file.emailSubject || file.title || 'Untitled';
    const date = getOriginalDate(file);
    const shifted = offsetReferences(file.markdown, offset);
    const sectionHeader = date ? `## ${header}\n\nDate: ${date}` : `## ${header}`;
    parts.push(`${sectionHeader}\n\n${shifted}`);
    offset += maxRefIndex(file.markdown);
  }

  return parts.join('\n\n---\n\n');
}

export function createMergedFile(files: CapturedFile[]): CapturedFile {
  const now = new Date().toISOString();
  const mergedDateSummary = getMergedDateSummary(files);

  return {
    id: crypto.randomUUID(),
    title: 'Merged Collection',
    sourceUrl: 'browserclaw://merged',
    capturedAt: now,
    markdown: mergeFilesMarkdown(files),
    links: [],
    depth: 0,
    siteType: 'generic',
    pageDate: mergedDateSummary,
    emailSubject: 'Merged Collection',
    isMerged: true,
    mergedPageCount: files.length,
  };
}
