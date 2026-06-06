import type { Chapter, ParseResult } from './types';

/** Maximum file size in bytes (2MB) */
export const MAX_FILE_SIZE = 2 * 1024 * 1024;

/** Chapter header patterns (ordered by priority) */
const CHAPTER_PATTERNS = [
  /^第[一二三四五六七八九十百千零〇0-9]+章\s*(.*)$/gm,     // "第一章 标题"
  /^第[0-9]+章\s*(.*)$/gm,                                   // "第1章 标题"
  /^第[一二三四五六七八九十]+节\s*(.*)$/gm,                   // "第一节 标题"
  /^(?:Chapter|CHAPTER|Ch)\.?\s*[0-9]+[：:.]?\s*(.*)$/gm,    // "Chapter 1: Title"
  /^```/gm,                                                   // Code block separator
];

/**
 * Extract title from novel text (first non-empty line).
 */
function extractTitle(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  // First substantial line (≥2 chars) is likely the title
  for (const line of lines) {
    if (line.length >= 2 && line.length < 80) {
      return line.replace(/^[#\s]+/, '');
    }
  }
  return '未命名作品';
}

/**
 * Detect chapters by matching against known patterns.
 * Falls back to paragraph-count splitting if no pattern matches.
 */
function detectChapters(text: string): { boundaries: Array<{ title: string; startIndex: number }>; usedFallback: boolean } {
  const matches: Array<{ title: string; startIndex: number; priority: number }> = [];

  for (let pi = 0; pi < CHAPTER_PATTERNS.length; pi++) {
    const pattern = CHAPTER_PATTERNS[pi];
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      // Extract the title portion after the chapter marker
      const rawTitle = match[1]?.trim() || '';
      const title = rawTitle || `第${matches.length + 1}章`;
      matches.push({
        title,
        startIndex: match.index,
        priority: pi,
      });
    }
  }

  if (matches.length === 0) {
    // Fallback: split by ~2000 character chunks
    return { boundaries: fallbackSplit(text), usedFallback: true };
  }

  // Deduplicate: if two matches overlap within 10 chars, keep the higher priority one
  matches.sort((a, b) => a.startIndex - b.startIndex);
  const deduped = matches.filter((m, i) => {
    if (i === 0) return true;
    const prevEnd = matches[i - 1].startIndex + 10;
    if (m.startIndex < prevEnd) {
      // Overlapping: keep the one with higher priority (lower number)
      return m.priority < matches[i - 1].priority;
    }
    return true;
  });

  return { boundaries: deduped.map((m) => ({ title: m.title, startIndex: m.startIndex })), usedFallback: false };
}

/**
 * Fallback: split text into roughly equal chunks when no chapter markers are found.
 */
function fallbackSplit(text: string): Array<{ title: string; startIndex: number }> {
  const CHUNK_SIZE = 2000;
  const boundaries: Array<{ title: string; startIndex: number }> = [];

  // Try to split at paragraph boundaries first
  const paragraphs = text.split(/\n\n+/);
  let currentPos = 0;
  let chunkCount = 0;

  for (let i = 0; i < paragraphs.length; ) {
    // Group paragraphs until we hit CHUNK_SIZE
    let chunkLen = 0;
    const startPos = currentPos;

    while (i < paragraphs.length && chunkLen < CHUNK_SIZE) {
      chunkLen += paragraphs[i].length + 2; // +2 for the paragraph separator
      currentPos += paragraphs[i].length + 2;
      i++;
    }

    chunkCount++;
    boundaries.push({
      title: `第${chunkCount}章`,
      startIndex: startPos,
    });
  }

  return boundaries;
}

/**
 * Parse raw novel text into chapters.
 * Validates encoding and file size.
 */
export function parseNovel(text: string, fileName?: string): ParseResult {
  const warnings: string[] = [];

  // Check for empty content
  if (!text || text.trim().length === 0) {
    return { title: '', chapters: [], warnings: ['文件内容为空'] };
  }

  // Auto-detect and extract title
  const title = extractTitle(text);

  // Detect chapters
  const { boundaries, usedFallback } = detectChapters(text);

  if (usedFallback) {
    warnings.push('未检测到章节标记，已按段落数自动切分章节');
  }

  if (boundaries.length === 0) {
    warnings.push('文本内容为空');
    return { title, chapters: [], warnings };
  }

  // Extract chapter texts from boundaries
  const chapters: Chapter[] = boundaries.map((boundary, i) => {
    const nextBoundary = boundaries[i + 1];
    const endIndex = nextBoundary ? nextBoundary.startIndex : text.length;
    const chapterText = text.slice(boundary.startIndex, endIndex).trim();
    const paragraphs = chapterText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    return {
      index: i,
      title: boundary.title,
      paragraphs,
      text: chapterText,
    };
  });

  return { title, chapters, warnings };
}

/**
 * Validate file type and size before reading.
 */
export function validateFile(file: {
  name: string;
  size: number;
  type?: string;
}): string | null {
  // Check extension
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext && !['txt', 'md', 'text'].includes(ext)) {
    return `不支持的文件格式 .${ext}，请上传 .txt 文件`;
  }

  // Check size
  if (file.size > MAX_FILE_SIZE) {
    return `文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB），请上传小于 2MB 的文件，或分章上传`;
  }

  if (file.size === 0) {
    return '文件为空';
  }

  return null;
}
