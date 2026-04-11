import type { AgentStore } from "@purityjs/agent-store";
import {
  getPendingObservations,
  observeProfileFromSession,
  observeProfileFromTask,
} from "@purityjs/agent-store";

export async function profile(store: AgentStore, args: string[]): Promise<void> {
  const sub = args[0];

  if (sub === "observe-task") {
    const userId = args[1];
    const taskId = args[2];
    if (!userId || !taskId) {
      console.error("Usage: agent-cp profile observe-task <userId> <taskId>");
      return;
    }

    const result = observeProfileFromTask(store, userId, taskId);
    if (result.skipped) {
      console.log(`Skipped: ${result.reason}`);
      return;
    }

    console.log(`Observed ${result.observed.length} preference(s):`);
    for (const key of result.observed) {
      console.log(`  ${key}`);
    }
    if (result.promoted.length > 0) {
      console.log(`Promoted ${result.promoted.length}:`);
      for (const key of result.promoted) {
        console.log(`  ${key}`);
      }
    }
    return;
  }

  if (sub === "observe-session") {
    const sessionId = args[1];
    if (!sessionId) {
      console.error("Usage: agent-cp profile observe-session <sessionId>");
      return;
    }

    const result = observeProfileFromSession(store, sessionId);
    if (result.skipped) {
      console.log(`Skipped: ${result.reason}`);
      return;
    }

    console.log(`Observed ${result.observed.length} preference(s):`);
    for (const key of result.observed) {
      console.log(`  ${key}`);
    }
    if (result.promoted.length > 0) {
      console.log(`Promoted ${result.promoted.length}:`);
      for (const key of result.promoted) {
        console.log(`  ${key}`);
      }
    }
    return;
  }

  if (sub === "pending") {
    const userId = args[1];
    if (!userId) {
      console.error("Usage: agent-cp profile pending <userId>");
      return;
    }

    const pending = getPendingObservations(store, userId);
    if (pending.length === 0) {
      console.log("No pending observations.");
      return;
    }

    console.log(`Pending observations for ${userId}: ${pending.length}`);
    for (const { key, observation } of pending) {
      const val = JSON.stringify(observation.value);
      console.log(`  ${key} = ${val} (seen ${observation.count}x)`);
    }
    return;
  }

  if (sub === "show") {
    const userId = args[1];
    if (!userId) {
      console.error("Usage: agent-cp profile show <userId>");
      return;
    }

    const p = store.getUserProfile(userId);
    if (!p) {
      console.log(`No profile for user "${userId}".`);
      return;
    }

    console.log(`Profile for ${p.userId} (updated: ${p.updatedAt}):`);
    for (const [key, value] of Object.entries(p.profile)) {
      if (key === "_pending") continue;
      console.log(`  ${key}: ${JSON.stringify(value)}`);
    }
    return;
  }

  console.log("Usage: agent-cp profile <observe-task|observe-session|pending|show> [options]");
  console.log();
  console.log("Subcommands:");
  console.log("  observe-task <userId> <taskId>  Observe preferences from a completed task");
  console.log("  observe-session <sessionId>     Observe preferences from all session tasks");
  console.log("  pending <userId>                Show pending (unconfirmed) observations");
  console.log("  show <userId>                   Show promoted user profile");
}
