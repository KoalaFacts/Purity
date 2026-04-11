import { openAgentStore } from "@purityjs/agent-store";
import type { AgentStore } from "@purityjs/agent-store";
import { extract } from "./commands/extract";
import { review } from "./commands/review";
import { evaluate } from "./commands/evaluate";
import { prune } from "./commands/prune";
import { digest } from "./commands/digest";
import { validate } from "./commands/validate";
import { retrieve } from "./commands/retrieve";
import { loop } from "./commands/loop";
import { createEvalCase } from "./commands/create-eval-case";
import { status } from "./commands/status";
import { feedback } from "./commands/feedback";
import { antipattern } from "./commands/antipattern";
import { profile } from "./commands/profile";
import { maintain } from "./commands/maintain";

const COMMANDS: Record<string, (store: AgentStore, args: string[]) => Promise<void>> = {
  extract,
  review,
  evaluate,
  prune,
  digest,
  validate,
  retrieve,
  loop,
  "create-eval-case": createEvalCase,
  status,
  feedback,
  antipattern,
  profile,
  maintain,
};

function printUsage(): void {
  console.log("Usage: agent-cp <command> [options]");
  console.log();
  console.log("Commands:");
  console.log("  extract   <taskId>          Extract candidates from a completed task");
  console.log("  review                     Review pending candidates");
  console.log("  evaluate  <skillVersionId>  Run evals for a skill version");
  console.log("  prune                      Run maintenance pruning");
  console.log("  digest                      Generate a review digest");
  console.log("  validate                    Validate active skills for regressions");
  console.log("  retrieve  --project <id> <q> Retrieve context for a new task");
  console.log("  loop      <taskId> [--dataset <id>] Run extract→review→evaluate");
  console.log("  create-eval-case <taskId> --dataset <id> Create eval case from task");
  console.log("  status                      Show store summary");
  console.log("  feedback  [summary|demote]   Skill invocation feedback & demotion");
  console.log("  antipattern [extract|list]  Extract/list failure anti-patterns");
  console.log("  profile    [observe-task|observe-session|pending|show] User profile");
  console.log("  maintain   [run [--force] [--job=<name>] | status]  Scheduled maintenance");
  console.log();
  console.log("Options:");
  console.log("  --db <path>  Path to agent.db (default: .agent/agent.db)");
}

function parseDbPath(args: string[]): { dbPath: string; rest: string[] } {
  const idx = args.indexOf("--db");
  if (idx >= 0 && args[idx + 1]) {
    const dbPath = args[idx + 1]!;
    const rest = [...args.slice(0, idx), ...args.slice(idx + 2)];
    return { dbPath, rest };
  }
  return { dbPath: ".agent/agent.db", rest: args };
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const command = rawArgs[0];

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }

  const { dbPath, rest } = parseDbPath(rawArgs.slice(1));

  let store: AgentStore | undefined;
  try {
    store = openAgentStore({ filename: dbPath, migrate: true });
    await handler(store, rest);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  } finally {
    store?.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
