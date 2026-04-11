import { describe, expect, it } from "vite-plus/test";
import { scoreTrajectoryMatch, createTrajectoryExecutor } from "../src/executor";
import type { EvalCaseExecutionContext } from "../src/index";
import type {
  EvalCase,
  EvalDatasetRecord,
  JsonObject,
  SkillVersionRecord,
} from "@purityjs/agent-types";

describe("trajectory-matching executor", () => {
  const baseInput: JsonObject = {
    taskId: "task_1",
    prompt: "Add batchUpdate to signals",
    outcomeSummary:
      "Added batchUpdate() to signals.ts. Defers watcher notifications. All tests pass.",
    filesTouched: ["packages/core/src/signals.ts", "packages/core/tests/signals.test.ts"],
    tools: ["grep_search", "read_file"],
    events: [
      {
        type: "tool_call",
        payload: { tool: "grep_search" },
        createdAt: "2026-04-11T09:01:00Z",
      },
      {
        type: "tool_call",
        payload: { tool: "read_file" },
        createdAt: "2026-04-11T09:02:00Z",
      },
      {
        type: "file_edit",
        payload: { path: "packages/core/src/signals.ts" },
        createdAt: "2026-04-11T09:03:00Z",
      },
      {
        type: "file_edit",
        payload: { path: "packages/core/tests/signals.test.ts" },
        createdAt: "2026-04-11T09:04:00Z",
      },
      {
        type: "validation",
        payload: { command: "vp test" },
        createdAt: "2026-04-11T09:05:00Z",
      },
    ],
  };

  const baseExpected: JsonObject = {
    outcomeSummary:
      "Added batchUpdate() to signals.ts. Defers watcher notifications. All tests pass.",
    filesTouched: ["packages/core/src/signals.ts", "packages/core/tests/signals.test.ts"],
    tools: ["grep_search", "read_file"],
  };

  describe("scoreTrajectoryMatch", () => {
    it("scores a well-matching skill highly", () => {
      const skill = [
        "# Add batchUpdate to signals",
        "",
        "1. Use `grep_search` to find existing batch logic",
        "2. Use `read_file` to read the current signals.ts",
        "3. Edit `signals.ts` to add batchUpdate() that defers watcher notifications",
        "4. Edit `signals.test.ts` to add tests for batch updates",
        "5. Run validation to ensure all tests pass",
      ].join("\n");

      const scores = scoreTrajectoryMatch(skill, baseInput, baseExpected);

      expect(scores.fileCoverage).toBeGreaterThan(0.5);
      expect(scores.toolCoverage).toBeGreaterThan(0.5);
      expect(scores.outcomeOverlap).toBeGreaterThan(0.2);
      expect(scores.stepAlignment).toBe(1); // 5 steps ≈ 5 events
      expect(scores.aggregate).toBeGreaterThan(0.4);
    });

    it("scores a completely unrelated skill low", () => {
      const skill = [
        "# Deploy to production",
        "",
        "Use SSH to connect to the server.",
        "Copy the build artifacts.",
        "Restart the service.",
      ].join("\n");

      const scores = scoreTrajectoryMatch(skill, baseInput, baseExpected);

      expect(scores.fileCoverage).toBe(0);
      expect(scores.toolCoverage).toBe(0);
      expect(scores.aggregate).toBeLessThan(0.4);
    });

    it("scores partial matches in between", () => {
      const skill = [
        "# Update signals module",
        "",
        "1. Read signals.ts to understand the current API",
        "2. Add the new function",
        "3. Run tests",
      ].join("\n");

      const scores = scoreTrajectoryMatch(skill, baseInput, baseExpected);

      // Mentions signals.ts but not signals.test.ts tools
      expect(scores.fileCoverage).toBeGreaterThan(0);
      expect(scores.aggregate).toBeGreaterThan(0.1);
      expect(scores.aggregate).toBeLessThan(0.9);
    });

    it("handles empty skill body gracefully", () => {
      const scores = scoreTrajectoryMatch("", baseInput, baseExpected);

      expect(scores.fileCoverage).toBe(0);
      expect(scores.toolCoverage).toBe(0);
      expect(scores.aggregate).toBeLessThan(0.5);
    });

    it("handles missing expected gracefully", () => {
      const scores = scoreTrajectoryMatch(
        "# Some skill\n1. Step one\n2. Step two",
        baseInput,
        undefined,
      );

      expect(scores.aggregate).toBeGreaterThanOrEqual(0);
      expect(scores.aggregate).toBeLessThanOrEqual(1);
    });

    it("respects custom weights", () => {
      const skill = "Edit `signals.ts` and `signals.test.ts`";
      const fileHeavy = scoreTrajectoryMatch(skill, baseInput, baseExpected, {
        weights: {
          fileCoverage: 10,
          toolCoverage: 0,
          outcomeOverlap: 0,
          stepAlignment: 0,
        },
      });
      const toolHeavy = scoreTrajectoryMatch(skill, baseInput, baseExpected, {
        weights: {
          fileCoverage: 0,
          toolCoverage: 10,
          outcomeOverlap: 0,
          stepAlignment: 0,
        },
      });

      // File-heavy should score higher (skill mentions files but not tools)
      expect(fileHeavy.aggregate).toBeGreaterThan(toolHeavy.aggregate);
    });
  });

  describe("createTrajectoryExecutor", () => {
    function makeContext(
      skillBody: string,
      input: JsonObject = baseInput,
      expected: JsonObject = baseExpected,
    ): EvalCaseExecutionContext {
      return {
        store: {} as EvalCaseExecutionContext["store"],
        dataset: {
          id: "ds_1",
          name: "test",
          scope: "project",
          createdAt: "2026-04-11T00:00:00Z",
        } as EvalDatasetRecord,
        evalCase: {
          id: "case_1",
          datasetId: "ds_1",
          title: "test case",
          input,
          expected,
          createdAt: "2026-04-11T00:00:00Z",
        } as EvalCase,
        skillVersion: {
          id: "sv_1",
          skillId: "s_1",
          version: 1,
          bodyMarkdown: skillBody,
          status: "candidate",
          createdAt: "2026-04-11T00:00:00Z",
        } as SkillVersionRecord,
      };
    }

    it("passes when score exceeds threshold", () => {
      const executor = createTrajectoryExecutor({ passThreshold: 0.3 });
      const skill = [
        "# Add batchUpdate to signals",
        "1. `grep_search` for batch logic",
        "2. `read_file` signals.ts",
        "3. Edit signals.ts — add batchUpdate()",
        "4. Edit signals.test.ts — add tests",
        "5. Run tests",
      ].join("\n");

      const result = executor(makeContext(skill));

      expect(result.passed).toBe(true);
      expect(result.score).toBeGreaterThan(0.3);
      expect(result.metrics).toBeDefined();
      expect(result.metrics!.fileCoverage).toBeGreaterThan(0);
    });

    it("fails when score is below threshold", () => {
      const executor = createTrajectoryExecutor({ passThreshold: 0.9 });
      const skill = "# Something vaguely related to code";

      const result = executor(makeContext(skill));

      expect(result.passed).toBe(false);
      expect(result.score).toBeLessThan(0.9);
    });

    it("returns per-dimension metrics", () => {
      const executor = createTrajectoryExecutor();
      const skill = "Edit signals.ts and signals.test.ts with grep_search and read_file";

      const result = executor(makeContext(skill));

      expect(result.metrics).toBeDefined();
      expect(typeof result.metrics!.fileCoverage).toBe("number");
      expect(typeof result.metrics!.toolCoverage).toBe("number");
      expect(typeof result.metrics!.outcomeOverlap).toBe("number");
      expect(typeof result.metrics!.stepAlignment).toBe("number");
    });
  });
});
