export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
}

export class Logger {
  private logs: LogEntry[] = [];

  log(level: LogLevel, message: string): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message,
    };
    this.logs.push(entry);
    if (process.env.NODE_ENV === 'development') {
      const prefix = `[${level.toUpperCase()}]`;
      if (level === 'error') console.error(prefix, message);
      else if (level === 'warn') console.warn(prefix, message);
      else console.log(prefix, message);
    }
  }

  info(message: string): void {
    this.log('info', message);
  }

  warn(message: string): void {
    this.log('warn', message);
  }

  error(message: string): void {
    this.log('error', message);
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  clear(): void {
    this.logs = [];
  }
}
