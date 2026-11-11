---
name: handoff
description: Compact the current conversation into a high-entropy, cold-start handoff document for another agent to pick up.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

# Session Handoff Compiler

Compile the current session into a self-contained handoff document so a fresh-context agent can resume execution immediately without chat history. Save to the OS temporary directory (`$TMPDIR`, else `/tmp`; `%TEMP%` on Windows) as `handoff-<timestamp>.md` — never inside the repository workspace.

## Authoring Rules

1. **Zero Duplication of Repo Artifacts:** Never copy code blocks, diffs, or prose already recorded in commits, issues, `docs/architecture.md`, `docs/invariants.md`, `docs/contracts/`, or `docs/adr/`. Reference them by exact path (`path/to/file.ext:line::symbol`) or commit SHA.
2. **Chain-of-Draft Compression:** Represent completed execution and remaining causal flows using compact steps ($\le 5\text{ words}$ per step) with exact identifiers (`Trigger -> Guard -> Mutation => Outcome`).
3. **Preserve Negative Space (Rejected Paths):** Explicitly record approaches tried and rejected during the session so the next agent does not repeat dead-end exploration.
4. **Redact Secrets:** Replace every credential, token, API key, or PII value with `<REDACTED>`.
5. **Tailor to Next Objective:** When the user passes arguments, scope the handoff around that target task.

## Output Schema

```markdown
# HANDOFF BRIEF
@META repo=<repo-root> | branch=<branch>@<short-sha> | next_focus=<user argument or next milestone>

## 1. @OBJECTIVE & ACTIVE CONSTRAINTS
- **Goal:** [1-2 sentences stating the exact deliverable for the next session]
- **Active Contracts & Invariants:** [Links to `docs/invariants.md` or `docs/contracts/*` governing the touched seam]
- **Suggested Skills to Load:** [Exact `.agents/skills/<name>/SKILL.md` paths for the next agent]

## 2. @STATE_SNAPSHOT (Completed vs. Uncommitted)
- **Committed (`git log`):** [`<sha>` — 1-line summary]
- **Working Tree (`git status`):** [`path/to/file.ext:line::symbol` — current state: green / failing / mid-refactor]
- **Verification Status:** `VERIFIED:` [exact test/check command + pass output] | `FAILING / UNVERIFIED:` [exact command + current symptom]

## 3. @DECISIONS_AND_SCAR_TISSUE (Do Not Re-Litigate)
- **Settled Decisions:** [Decision + 1-line rationale]
- **Rejected Paths / Dead Ends:** `[Attempted approach] -> [Why it failed / violated invariant] -> [Do not retry unless X changes]`

## 4. @OPEN_FRONTIER & FIRST COMMAND
1. **First Command to Run:** `<exact CLI verification or test command>`
2. **Next Implementation Steps:**
   - `Step 1`: [Action targeting `file.ext:line::symbol` + completion check]
   - `Step 2`: [Action + completion check]
```

## Completion Criterion (Cold-Start Visibility Audit)

Before saving the file, audit the draft as an independent agent with **zero access to the current conversation**:
- [ ] Every referenced file, symbol, and commit SHA is exact and unabbreviated.
- [ ] Every decision-critical constraint and rejected dead end from the chat is visible in Section 3.
- [ ] The next agent can run **First Command to Run** in Section 4 immediately without re-exploring settled code.