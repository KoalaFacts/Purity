# Harness memory — Purity

Why each change to this repo's harness (`advance-purity`, `verify-purity`, the gate, friction-removing scripts and checks) was made, what it was meant to fix and whether it did, organised by root cause (agent-harness autonomous-dev §8.1). Read it whole every run; attempts are never deleted or softened.

Created 2026-11-26. Attempts marked "retroactive" were recorded after the fact from merged PRs and the ledger run log: their predictions were not written before evaluation and the model was not recorded.

## RC-1 Hosted CI and Codex review never arrive, so merges stall across runs
Status: settled
Inherited: envoylet RC-2 — Actions blocked by billing and Codex usage limits; the local gate plus one independent review agent stand in, and PR bodies say so.
- A1 · PRs #384–#401, #413 · 2026-11-09…2026-11-22 · model not recorded (retroactive)
  Change: `advance-purity` Project rules follow the 2026-11-17 decision policy — a Codex review not completed within 45 minutes, or "Failed", no longer blocks; the full local gate plus an independent review agent stand in. Why: #384–#386 waited only on Codex for days (ledger run log 2026-11-09); #399/#400 waited on a hosted audit failure until owner decision #401. Predict (retroactive): PRs merge in the run that opens them unless a hosted check that ran has failed.
  Observed: 2026-11-26 #413, #417, #418 each merged in its opening run with the local gate and an independent review → kept

## RC-2 Benchmark comparator records drift from what the benchmark actually installs
Status: open
- A1 · PR #417 · 2026-11-25 · model not recorded (retroactive)
  Change: `benchmark/tools/comparator-record.test.ts` pins `target.json` `benchmarkWorkspaceComparator` to the lockfile's Solid versions and integrity. Why: benchmark claims must name the exact Solid version, and Dependabot bumps silently made the record stale. Predict: the next Solid bump fails `npm test` until the record is updated.
  Observed: 2026-11-26 #430 (Solid 2.0.0-rc.21 → 2.0.4) failed exactly that test until `target.json` was updated → kept

## RC-3 Setup notes go stale when the cloud image changes, and a run loses time on them
Status: open
Inherited: tcr RC-1 / envoylet RC-3 — the image ships Node 22 only; downloading Node 24 takes about a minute; the rule that held is "check, otherwise download", not a hard-coded image path.
- A1 · PR #431 · 2026-11-26 · claude-opus-5-5
  Change: none to the Setup text yet; recorded that on 2026-11-26 the image had Node 22.23.5 and npm 10.9.9 (`npm ci` fails on `devEngines` with EBADDEVENGINES), and `npm i node@24 npm@11` into the scratchpad with its `.bin` first on `PATH` (the existing Setup line) worked in about 10 s. Why: first run with this memory. Predict: by 2026-12-03 no Purity run's PR body or report names Node/npm setup as a cause of lost time or a gate failure; if one does, the next harness PR turns the Setup line into a script.
  Observed: pending (check 2026-12-03)

## RC-4 The tracker cannot read this repo's progress
Status: open
Inherited: agent-harness RC-5 — `advance-<repo>` must declare `ledger:` in its frontmatter; the rule alone did not get it fixed, so missing lines are added directly.
- A1 · PR #431 · 2026-11-26 · claude-opus-5-5
  Change: `ledger: docs/plans/surpass-solid.md` added to `advance-purity`'s frontmatter, and this memory created. Why: `get_overview` on 2026-11-26 reported "台账：advance skill 未声明 ledger" for purity. Predict: within a day of merging, `get_overview` for purity shows no 台账 (ledger) reason, and `list_root_causes` lists purity.
  Observed: pending (check 2026-11-27)
