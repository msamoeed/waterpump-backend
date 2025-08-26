import { LoggerService } from '@nestjs/common';

export interface LoggingConfig {
  level: string;
  maxFiles: number;
  maxSize: string;
  bufferSize: number;
  flushInterval: number;
}

export const loggingConfig: LoggingConfig = {
  level: process.env.LOG_LEVEL || 'warn',
  maxFiles: parseInt(process.env.LOG_MAX_FILES || '5'),
  maxSize: process.env.LOG_MAX_SIZE || '10m',
  bufferSize: parseInt(process.env.LOG_BUFFER_SIZE || '1000'),
  flushInterval: parseInt(process.env.LOG_FLUSH_INTERVAL || '5000'),
};

export class MemoryOptimizedLogger implements LoggerService {
  private buffer: string[] = [];
  private bufferSize: number;
  private flushInterval: number;
  private flushTimer: NodeJS.Timeout;

  constructor() {
    this.bufferSize = loggingConfig.bufferSize;
    this.flushInterval = loggingConfig.flushInterval;
    this.startFlushTimer();
  }

  private startFlushTimer() {
    this.flushTimer = setInterval(() => {
      this.flushBuffer();
    }, this.flushInterval);
    
    // Force garbage collection hint after flush to prevent memory buildup
    if (global.gc) {
      setInterval(() => {
        global.gc();
      }, 30000); // Every 30 seconds
    }
  }

  private addToBuffer(message: string) {
    this.buffer.push(message);
    
    // If buffer is full, flush immediately
    if (this.buffer.length >= this.bufferSize) {
      this.flushBuffer();
    }
  }

  private flushBuffer() {
    if (this.buffer.length > 0) {
      // Write to console in batches to prevent memory buildup
      console.log(this.buffer.join('\n'));
      this.buffer = [];
    }
  }

  log(message: string, context?: string) {
    if (loggingConfig.level === 'log' || loggingConfig.level === 'debug') {
      this.addToBuffer(`[LOG] ${context ? `[${context}] ` : ''}${message}`);
    }
  }

  error(message: string, trace?: string, context?: string) {
    this.addToBuffer(`[ERROR] ${context ? `[${context}] ` : ''}${message}${trace ? `\n${trace}` : ''}`);
  }

  warn(message: string, context?: string) {
    if (loggingConfig.level === 'warn' || loggingConfig.level === 'log' || loggingConfig.level === 'debug') {
      this.addToBuffer(`[WARN] ${context ? `[${context}] ` : ''}${message}`);
    }
  }

  debug(message: string, context?: string) {
    if (loggingConfig.level === 'debug') {
      this.addToBuffer(`[DEBUG] ${context ? `[${context}] ` : ''}${message}`);
    }
  }

  verbose(message: string, context?: string) {
    if (loggingConfig.level === 'verbose' || loggingConfig.level === 'debug') {
      this.addToBuffer(`[VERBOSE] ${context ? `[${context}] ` : ''}${message}`);
    }
  }

  onModuleDestroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushBuffer();
    }
  }
}
