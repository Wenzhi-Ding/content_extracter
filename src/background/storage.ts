import type { CapturedFile, UserConfig } from '../shared/types';
import { STORAGE_KEYS, DEFAULT_CONFIG } from '../shared/constants';

export async function getFiles(): Promise<CapturedFile[]> {
  const result = await chrome.storage.session.get(STORAGE_KEYS.FILES);
  return result[STORAGE_KEYS.FILES] || [];
}

export async function saveFiles(files: CapturedFile[]): Promise<void> {
  await chrome.storage.session.set({ [STORAGE_KEYS.FILES]: files });
}

export async function addFile(file: CapturedFile): Promise<CapturedFile[]> {
  const files = await getFiles();
  files.push(file);
  await saveFiles(files);
  return files;
}

export async function deleteFile(fileId: string): Promise<CapturedFile[]> {
  const files = await getFiles();
  const filtered = files.filter(f => f.id !== fileId);
  await saveFiles(filtered);
  return filtered;
}

export async function clearFiles(): Promise<void> {
  await saveFiles([]);
}

export async function updateFile(fileId: string, updates: Partial<CapturedFile>): Promise<CapturedFile[]> {
  const files = await getFiles();
  const updated = files.map(f => f.id === fileId ? { ...f, ...updates } : f);
  await saveFiles(updated);
  return updated;
}

export async function getConfig(): Promise<UserConfig> {
  const result = await chrome.storage.sync.get(STORAGE_KEYS.CONFIG);
  const stored = result[STORAGE_KEYS.CONFIG] || {};
  return { ...DEFAULT_CONFIG, ...stored };
}

export async function saveConfig(partial: Partial<UserConfig>): Promise<UserConfig> {
  const current = await getConfig();
  const merged = { ...current, ...partial };
  await chrome.storage.sync.set({ [STORAGE_KEYS.CONFIG]: merged });
  return merged;
}
