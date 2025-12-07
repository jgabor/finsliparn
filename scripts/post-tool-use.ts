#!/usr/bin/env bun
/**
 * PostToolUse hook for Finsliparn
 * Detects file edits during active sessions and injects refinement feedback
 */

declare const Bun: {
  stdin: { text(): Promise<string> };
  file(path: string): { text(): Promise<string> };
};

import { readdir } from "node:fs/promises";
import { join } from "node:path";

type HookInput = {
  session_id: string;
  cwd: string;
  hook_event_name: string;
  tool_name: string;
  tool_input: {
    file_path?: string;
    content?: string;
    old_string?: string;
    new_string?: string;
  };
  tool_response: {
    filePath?: string;
    success?: boolean;
  };
};

type HookOutput = {
  decision?: "block";
  reason?: string;
  hookSpecificOutput?: {
    hookEventName: string;
    additionalContext?: string;
  };
};

async function findActiveSession(
  cwd: string
): Promise<{ id: string; taskDescription: string } | null> {
  const sessionsDir = join(cwd, ".finsliparn", "sessions");
  try {
    const entries = await readdir(sessionsDir);
    for (const entry of entries) {
      const statePath = join(sessionsDir, entry, "state.json");
      try {
        const content = await Bun.file(statePath).text();
        const session = JSON.parse(content);
        if (
          session.status === "iterating" ||
          session.status === "initializing"
        ) {
          return { id: session.id, taskDescription: session.taskDescription };
        }
      } catch {
        // Skip invalid session files
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function main() {
  let input: HookInput;
  try {
    const stdin = await Bun.stdin.text();
    input = JSON.parse(stdin);
  } catch {
    process.exit(1);
  }

  const activeSession = await findActiveSession(input.cwd);
  if (!activeSession) {
    process.exit(0);
  }

  const filePath = input.tool_input.file_path ?? input.tool_response.filePath;
  if (!filePath) {
    process.exit(0);
  }

  const output: HookOutput = {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `
**Finsliparn session active**: ${activeSession.id}
**Task**: ${activeSession.taskDescription}

A file was modified. To continue the refinement loop:
1. Call \`finslipa_check\` with sessionId "${activeSession.id}" to run tests and get feedback
2. Read the updated directive at \`.finsliparn/directive.md\`
3. Address any failing tests based on the feedback
`.trim(),
    },
  };

  console.log(JSON.stringify(output));
}

main().catch(() => process.exit(1));
