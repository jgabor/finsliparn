/**
 * Structured debug logging for Finsliparn
 *
 * Enable with FINSLIPARN_DEBUG=1 environment variable
 * Outputs to stderr to avoid polluting MCP responses
 */

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

type LogContext = Record<string, unknown>;

const LOG_LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

class Logger {
  private readonly enabled: boolean;
  private readonly minLevel: LogLevel;
  private readonly component: string;

  constructor(component: string) {
    this.component = component;
    this.enabled = process.env.FINSLIPARN_DEBUG === "1";
    this.minLevel = (process.env.FINSLIPARN_LOG_LEVEL as LogLevel) ?? "DEBUG";
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.enabled) {
      return level === "ERROR";
    }
    return LOG_LEVELS[level] >= LOG_LEVELS[this.minLevel];
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    context?: LogContext
  ): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` ${JSON.stringify(context)}` : "";
    return `[${timestamp}] [${level}] [${this.component}] ${message}${contextStr}`;
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog("DEBUG")) {
      console.error(this.formatMessage("DEBUG", message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog("INFO")) {
      console.error(this.formatMessage("INFO", message, context));
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog("WARN")) {
      console.error(this.formatMessage("WARN", message, context));
    }
  }

  error(message: string, context?: LogContext): void {
    if (this.shouldLog("ERROR")) {
      console.error(this.formatMessage("ERROR", message, context));
    }
  }
}

export function createLogger(component: string): Logger {
  return new Logger(component);
}
