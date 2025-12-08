import { parseArgs } from "node:util";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { configureLogger, createLogger } from "../core/logger";
import {
  finslipaCancel,
  finslipaCheck,
  finslipaClean,
  finslipaMerge,
  finslipaStart,
  finslipaStatus,
  finslipaVote,
} from "./tools";

const { values: cliArgs } = parseArgs({
  options: {
    debug: {
      type: "boolean",
      default: false,
    },
    "log-path": {
      type: "string",
    },
  },
  strict: false,
});

configureLogger({
  debug: cliArgs.debug,
  logPath: cliArgs["log-path"],
});

const log = createLogger("server");
const VERSION = "1.0.0";

log.info(`Finsliparn v${VERSION} running`, {
  debug: cliArgs.debug,
  logPath: cliArgs["log-path"],
  cwd: process.cwd(),
  pid: process.pid,
});

const server = new Server(
  { name: "finsliparn", version: VERSION },
  { capabilities: { tools: { listChanged: true } } }
);

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: [
    {
      name: "finslipa_start",
      description:
        "Initialize a new test-validated refinement session. Creates session state and initial directive.",
      inputSchema: {
        type: "object",
        properties: {
          taskDescription: {
            type: "string",
            description: "Description of the coding task to accomplish",
          },
          maxIterations: {
            type: "number",
            description: "Maximum refinement iterations (default: 5)",
          },
          forceNew: {
            type: "boolean",
            description:
              "Force creation of a new session even if an active session exists",
          },
          mergeThreshold: {
            type: "number",
            description:
              "Minimum score (0-100) required to merge. If not provided, merge protection is disabled.",
          },
        },
        required: ["taskDescription"],
      },
    },
    {
      name: "finslipa_check",
      description:
        "Run tests, score the current iteration, and update the directive with feedback. This is the refinement loop heartbeat.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: {
            type: "string",
            description: "The session ID to check",
          },
        },
        required: ["sessionId"],
      },
    },
    {
      name: "finslipa_status",
      description: "Retrieve the current state of a refinement session.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: {
            type: "string",
            description: "The session ID to query",
          },
        },
        required: ["sessionId"],
      },
    },
    {
      name: "finslipa_vote",
      description:
        "Select the best iteration based on scoring strategy. Stub for Phase 1 - returns highest scoring iteration.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: {
            type: "string",
            description: "The session ID to vote on",
          },
          strategy: {
            type: "string",
            enum: ["highest_score", "minimal_diff", "balanced"],
            description: "Voting strategy (default: highest_score)",
          },
        },
        required: ["sessionId"],
      },
    },
    {
      name: "finslipa_merge",
      description:
        "Merge the selected winning iteration back to the main branch.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: {
            type: "string",
            description: "The session ID to merge",
          },
          iterationNumber: {
            type: "number",
            description:
              "Specific iteration to merge (defaults to selected winner)",
          },
        },
        required: ["sessionId"],
      },
    },
    {
      name: "finslipa_cancel",
      description:
        "Cancel an active refinement session and clean up worktrees.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: {
            type: "string",
            description: "The session ID to cancel",
          },
        },
        required: ["sessionId"],
      },
    },
    {
      name: "finslipa_clean",
      description:
        "Delete session directories that have been cancelled or completed.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: {
            type: "string",
            description:
              "Specific session ID to clean. If not provided, cleans all finished sessions.",
          },
          status: {
            type: "string",
            enum: ["completed", "cancelled"],
            description:
              "Clean only sessions with this status. If not provided, cleans all finished sessions.",
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "finslipa_start": {
      const result = await finslipaStart(
        args as {
          taskDescription: string;
          maxIterations?: number;
          forceNew?: boolean;
          mergeThreshold?: number;
        }
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
    case "finslipa_check": {
      const result = await finslipaCheck(args as { sessionId: string });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
    case "finslipa_status": {
      const result = await finslipaStatus(args as { sessionId: string });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
    case "finslipa_vote": {
      const result = await finslipaVote(
        args as {
          sessionId: string;
          strategy?: "highest_score" | "minimal_diff" | "balanced";
        }
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
    case "finslipa_merge": {
      const result = await finslipaMerge(
        args as { sessionId: string; iterationNumber?: number }
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
    case "finslipa_cancel": {
      const result = await finslipaCancel(args as { sessionId: string });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
    case "finslipa_clean": {
      const result = await finslipaClean(
        args as { sessionId?: string; status?: "completed" | "cancelled" }
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
