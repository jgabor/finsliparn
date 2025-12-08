/**
 * Structured debug logging for Finsliparn
 *
 * Enable with FINSLIPARN_DEBUG=1 environment variable or --debug flag
 * Configure log file with FINSLIPARN_LOG_PATH environment variable or --log-path flag
 * Outputs to stderr (or file) to avoid polluting MCP responses
 */

import { appendFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

type LogContext = Record<string, unknown>;

const LOG_LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

type LoggerConfig = {
  debug: boolean;
  logPath: string | undefined;
};

const globalConfig: LoggerConfig = {
  debug: false,
  logPath: undefined,
};

const FILE_EXTENSION_REGEX = /\.\w+$/;

function resolveLogFilePath(logPath: string): string {
  const hasFileExtension = FILE_EXTENSION_REGEX.test(logPath);
  if (
    logPath.endsWith("/") ||
    !hasFileExtension ||
    (existsSync(logPath) && statSync(logPath).isDirectory())
  ) {
    return join(logPath, "finsliparn.log");
  }
  return logPath;
}

export function configureLogger(options: Partial<LoggerConfig>): void {
  if (options.debug !== undefined) {
    globalConfig.debug = options.debug;
  }
  if (options.logPath !== undefined) {
    globalConfig.logPath = options.logPath;
  }
}

class Logger {
  private readonly minLevel: LogLevel;
  private readonly component: string;

  constructor(component: string) {
    this.component = component;
    this.minLevel = (process.env.FINSLIPARN_LOG_LEVEL as LogLevel) ?? "DEBUG";
  }

  private isEnabled(): boolean {
    return globalConfig.debug || process.env.FINSLIPARN_DEBUG === "1";
  }

  private getLogPath(): string | undefined {
    return globalConfig.logPath ?? process.env.FINSLIPARN_LOG_PATH;
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.isEnabled()) {
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

  private output(formattedMessage: string): void {
    const logPath = this.getLogPath();
    if (logPath) {
      const resolvedPath = resolveLogFilePath(logPath);
      mkdirSync(dirname(resolvedPath), { recursive: true });
      appendFileSync(resolvedPath, `${formattedMessage}\n`);
    } else {
      console.error(formattedMessage);
    }
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog("DEBUG")) {
      this.output(this.formatMessage("DEBUG", message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog("INFO")) {
      this.output(this.formatMessage("INFO", message, context));
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog("WARN")) {
      this.output(this.formatMessage("WARN", message, context));
    }
  }

  error(message: string, context?: LogContext): void {
    if (this.shouldLog("ERROR")) {
      this.output(this.formatMessage("ERROR", message, context));
    }
  }
}

export function createLogger(component: string): Logger {
  return new Logger(component);
}
