---
name: retro
description: "Conduct a retrospective on a coding session."
disable-model-invocation: true
---

The user has asked for a **retrospective**. Diagnose friction in the coding agent's **environment, skills, and context infrastructure** to improve future runs.

## Steps

1. Load [`writing-for-agents`](../writing-for-agents/SKILL.md) for the writing style guide. Use the harness's native skill loader when available; otherwise, read the linked file directly.

2. **Inspect Raw Execution Traces (Meta-Harness Rule):**
   Read the primary sources for the specified session (or the current session if unspecified): raw tool calls, command outputs, failed diffs, and test logs. Do not diagnose from a lossy high-level summary. For every friction point, isolate the exact causal trace (`Initial State -> Agent Action / Tool Call -> Observable Failure`).

3. **Classify Every Friction Point into the Orthogonal A/B/C Taxonomy (GEPA Rule):**
   Keep failure modes strictly separated so system bugs, prompt gaps, and reasoning flaws do not collapse into one another:
   - **Category A — System & Harness Topology Failures:** What broke in execution, tooling, or handoffs independent of role quality (missing CLI/MCP access, truncated output, context loss across subagent handoff, un-wired lint/type/test guardrail, or token-expensive tool loops).
   - **Category B — Role & Skill Specification Failures:** The skill or agent ran and produced usable output, but missed what mattered, worked superficially, or chose the wrong method because its `SKILL.md`, trigger pointer, or completion criterion was weak or ambiguous.
   - **Category C — Epistemic & Reasoning Failures:** Logic flaws independent of which component committed them (e.g., `Partial_Verification_Treated_As_Full`, `Absence_Of_Evidence_Treated_As_Evidence_Of_Absence`, `Premature_Completion_Before_Red_Loop`, `Unverified_Author_Claim_Accepted`).

4. **Map Each Classified Failure to a Concrete Lever:**
   - **Navigation:** Did the agent spend multiple turns locating files or hidden couplings? Add or sharpen a **context pointer** in `AGENTS.md` or `docs/architecture.md`.
   - **Automated Checks:** Could a deterministic check have caught the mistake? Read the repo's existing check scripts (`package.json`, `Cargo.toml`, CI workflows) first so an unwired or broken check is wired rather than reinvented. A repo without a pre-commit or CI guardrail is itself a Category A finding.
   - **Coding Standards (Mechanical vs. Judgement):**
     - *Mechanical violations* (fixed syntax pattern, banned API, import boundary, file-location rule) get a **deterministic check** (AST rule, linter, pre-commit hook, or `validate_skills.py` check), never prose.
     - *Judgement calls* (cross-file invariant preservation, load-bearing rationale) belong in `docs/invariants.md`, `docs/contracts/`, or review skill baselines.
   - **Steering & Pruning (`AGENTS.md`):** Move domain detail out of `AGENTS.md` into Tier 3 owning docs (`docs/architecture.md`, `docs/contracts/`, `docs/invariants.md`). Delete **no-ops** (instructions the model already follows by default).
   - **Tool Economy & Information Access:** Replace noisy or high-token commands with `rtk`, `ast-grep outline`, or targeted scripts; surface missing read-only access or log tees.

5. **State the Counterfactual & Present Ranked Candidates:**
   Present candidates in order of severity. For each candidate, state:
   - **`[Category A | B | C]` — Named Failure Mode**
   - **Trace Evidence:** Exact tool call, file path, or turn where friction occurred.
   - **Counterfactual Diagnosis:** Which specific missing pointer, weak completion criterion, or absent check caused the agent to take the wrong branch.
   - **Proposed Edit:** Exact diff or check to add. Apply edits only with the user's agreement.

## Reference

### Implementation vs. Review Context Pressure

All work goes through two stages: **implementation** and **review**.
- The **implementation agent** operates under maximum **context pressure** (exploration, editing, debugging). Keep implementation steering minimal and rely on deterministic checks and pre-change trigger pointers.
- The **review agent** operates under low context pressure (it receives a bounded diff). Route judgement-heavy coding standards and invariant audits to the review stage (`decision-pr-review`).

### Routing Ownership

- `AGENTS.md` / `CLAUDE.md` (Tier 1 Hot Memory): Always loaded. Reserve strictly for the Orchestration Trigger Table, tool routing, and top-level context pointers.
- `.agents/skills/*` (Tier 2 Specialists): Workflow steps, completion criteria, and role-specific guardrails. Follow [`writing-for-agents`](../writing-for-agents/SKILL.md).
- `docs/architecture.md`, `docs/invariants.md`, `docs/contracts/` (Tier 3 Cold Memory): Owning documents for structure, high-entropy constraints, and seam guarantees.