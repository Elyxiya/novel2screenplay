/** A single chapter extracted from the novel text */
export interface Chapter {
  index: number;
  title: string;
  paragraphs: string[];
  text: string;
}

/** Result of parsing raw novel text */
export interface ParseResult {
  title: string;
  chapters: Chapter[];
  warnings: string[];
}
