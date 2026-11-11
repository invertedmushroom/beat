---
name: doubt-driven-development
description: Subjects a consequential decision to a fresh-context adversarial review before it stands. Use when explicitly requested, when stress-testing a plan for hidden failure modes, or when stakes are high and hard to reverse (production auth, security-sensitive logic, a high-stakes migration, irreversible operations) and the claim cannot be verified mechanically by compilation, types, or focused tests.
---

# Doubt-Driven Development

## Overview

A confident answer is not a correct one. Long sessions accumulate context that quietly turns assumptions into "facts" without anyone noticing. Doubt-driven development is the discipline of materializing a fresh-context reviewer — biased to **disprove**, not approve — before a consequential output stands.

This is not `/review`. `/review` is a verdict on a finished artifact. This is an in-flight posture: consequential decisions get cross-examined while course-correction is still cheap.

## When to Use

**Mechanical evidence comes first.** A compile, a type check, a focused regression test, or a runtime probe is stronger and cheaper verification than another model's opinion. Reach for a fresh-context reviewer for claims those checks cannot express.

A decision is **consequential** when at least one of these is true:

- Its blast radius is hard to reverse (production deploy, data migration, public API change)
- It is security-sensitive (auth, secrets, untrusted input)
- It asserts a property no compiler, type system, or focused test can verify (thread safety, idempotence, ordering, cross-system invariants)
- The user explicitly asked for adversarial verification

Apply the skill when:

- About to make a hard-to-reverse architectural decision under uncertainty
- About to claim a non-obvious fact that mechanical checks cannot verify ("this is safe", "this scales", "this matches the spec")

**When NOT to use:**

- Mechanical operations (renaming, formatting, file moves)
- Routine branching logic or module-crossing changes whose correctness compilation and focused tests already cover
- Following a clear, unambiguous user instruction
- Reading or summarizing existing code
- One-line changes with obvious correctness
- Pure tooling operations (running tests, listing files)
- The user has explicitly asked for speed over verification

If you doubt every keystroke, you ship nothing. The skill applies only to consequential decisions as defined above.

## Loading Constraints

This skill is designed for the **main-session orchestrator**, where Step 3 (DOUBT, detailed below) can spawn a fresh-context reviewer.

- **Do NOT add this skill to a persona's `skills:` frontmatter.** A persona that follows Step 3 would spawn another persona — an orchestration anti-pattern ("personas do not invoke other personas").
- **If you find yourself applying this skill from inside a subagent context** (where Claude Code prevents nested subagent spawn): the preferred path is to surface to the user that doubt-driven cannot run nested and let the main session handle it. As a last resort only, a degraded self-questioning fallback exists — rewrite ARTIFACT + CONTRACT as a fresh self-prompt with a hard mental separator from your prior reasoning, and walk Steps 1–5. This is **not fresh-context review** (you carry your own context with you), so flag the result as degraded and prefer escalation whenever the user is reachable.

## The Process

Copy this checklist when applying the skill:

```
Doubt cycle:
- [ ] Step 1: CLAIM — wrote the claim + why-it-matters
- [ ] Step 2: EXTRACT — isolated artifact + contract, stripped reasoning
- [ ] Step 3: DOUBT — invoked fresh-context reviewer with adversarial prompt
- [ ] Step 4: RECONCILE — classified every finding against the artifact text
- [ ] Step 5: STOP — met stop condition (trivial findings, 3 cycles, or user override)
```

### Step 1: CLAIM — Surface what stands

Name the decision in two or three lines:

```
CLAIM: "The new caching layer is thread-safe under the
        read-heavy workload described in the spec."
WHY THIS MATTERS: a race here corrupts user data and is
                  hard to detect in QA.
```

If you can't write the claim that compactly, you have a vibe, not a decision. Surface it before scrutinizing it.

### Step 2: EXTRACT — Smallest reviewable unit

A fresh-context reviewer needs the **artifact** and the **contract**, not the journey.

- Code: the diff or the function — not the whole file
- Decision: the proposal in 3–5 sentences plus the constraints it has to satisfy
- Assertion: the claim plus the evidence that supposedly supports it (kept distinct from the Step 1 CLAIM block, which is the orchestrator's hypothesis under scrutiny)

When `docs/invariants.md` or `docs/architecture.md` cover the touched area, draw the contract's constraints from them: they are the repository's stated obligations, not your reasoning, so passing them does not bias the reviewer.

Strip your reasoning. If you hand over conclusions, you'll get back validation of your conclusions. The unit must be small enough that a reviewer can hold it in mind in one read — if it's a 500-line PR, decompose first.

### Step 3: DOUBT — Invoke the fresh-context reviewer

The reviewer's prompt **must be adversarial**. Framing decides the answer.

```
Adversarial review. Find what is wrong with this artifact.
Assume the author is overconfident. Look for:
- Unstated assumptions
- Edge cases not handled
- Hidden coupling or shared state
- Ways the contract could be violated
- Existing conventions this might break
- Failure modes under unexpected input

Do NOT validate. Do NOT summarize. Find issues, or state
explicitly that you cannot find any after thorough examination.

ARTIFACT: <paste artifact>
CONTRACT: <paste contract>
```

**Pass ARTIFACT + CONTRACT only. Do NOT pass the CLAIM.** Handing the reviewer your conclusion biases it toward agreement. The reviewer must independently determine whether the artifact satisfies the contract.

Spawn a fresh-context subagent for this step so it starts with isolated context. **The adversarial prompt above takes precedence over any default review template.** Whereas `decision-pr-review` produces a structured decision brief across the whole diff, doubt-driven needs an issues-only disproof attempt on the extracted unit. Paste the adversarial prompt verbatim into the subagent invocation so it overrides default conversational framing.

#### Cross-model escalation (opt-in)

A single-model reviewer shares blind spots with the original author — a colder, different-architecture model catches them. But cross-model is an optional verification strategy, not a mandatory stop: compilation, focused regression tests, and runtime probes are usually stronger evidence at lower cost.

**Offer cross-model only when** the decision is hard to reverse or security-sensitive, when single-model review cycles keep disagreeing, or when the user asks for it. Do not pause every cycle to ask.

**Step 1: Ask the user (when the offer applies)**

After the single-model review in Step 3 above, but before RECONCILE, ask:

> *"Single-model review complete. Want a cross-model second opinion? Options: Gemini CLI, Codex CLI, manual external review (you paste it elsewhere), or skip."*

The user — not the agent — decides whether the cost is worth it.

**Step 2: If the user picks a CLI — verify, then invoke**

1. Check the tool is in PATH (`which gemini`, `which codex`).
2. Test it works (`gemini --version` or equivalent) before passing the full prompt — a stale or broken binary may pass `which` but fail on real input.
3. Confirm the exact invocation with the user, including required flags, auth, and env vars (e.g., API keys). Implementations vary; never assume.
4. Pass ARTIFACT + CONTRACT + the adversarial prompt **only**. No session context, no CLAIM.
5. Mind shell escaping. If the artifact contains quotes, `$(...)`, or backticks, prefer stdin (`echo … | gemini`) or a heredoc over inline `-p "…"`. When in doubt, ask the user to confirm the invocation before running it.
6. Take the output into Step 4 (RECONCILE).

**Never interpolate the artifact into a shell-quoted argument.** Code, markdown, and review prompts routinely contain backticks, `$(...)`, and quote characters that will either truncate the prompt or execute embedded shell. Write the full prompt to a file and pipe it through stdin.

Example shapes (verify flags against your installed tool — syntax differs across implementations and versions):

```bash
# Write the adversarial prompt + ARTIFACT + CONTRACT to a temp file first.
# Then pipe via stdin so shell metacharacters in the artifact stay inert.

# Codex (read-only sandbox keeps the CLI from writing to your workspace):
codex exec --sandbox read-only -C <repo-path> - < /tmp/doubt-prompt.md

# Gemini ('--approval-mode plan' is read-only; '-p ""' triggers non-interactive
# mode and the prompt is read from stdin):
gemini --approval-mode plan -p "" < /tmp/doubt-prompt.md
```

A read-only sandbox is the load-bearing detail: a doubt artifact may itself contain instructions (intentional or accidental prompt injection) that the cross-model CLI would otherwise execute against your workspace.

**Step 3: If the CLI is unavailable or fails**

Surface the failure explicitly. Offer: run it manually, try a different tool, or skip. Do not silently fall back to single-model — the user should know cross-model didn't happen.

**Step 4: If the user skips**

Acknowledge the skip in the output (*"Proceeding with single-model findings only"*) and continue to RECONCILE. Skipping is fine; silent skipping is not.

**Non-interactive contexts** (CI, `/loop`, autonomous-loop, scheduled runs):

- Cross-model is unavailable. If the stakes would have warranted an offer, announce it in the output: *"Cross-model skipped: non-interactive context."*
- **Never invoke an external CLI without explicit user authorization** — this is a load-bearing safety property.

Cross-model adds cost, latency, and tool fragility. Surface the choice when the stakes warrant it; the user decides whether this artifact is worth it.

### Step 4: RECONCILE — Fold findings back

The reviewer's output is data, not verdict. **You are still the orchestrator.** Re-read the artifact text against each finding before classifying — rubber-stamping the reviewer is the same failure mode as ignoring it.

For each finding, classify in this **precedence order** (first matching class wins):

1. **Contract misread** — reviewer flagged something specifically because the CONTRACT you provided was unclear or incomplete. Fix the contract first, re-classify on the next cycle.
2. **Valid + actionable** — real issue requiring a change to the artifact. Change it, re-loop.
3. **Valid trade-off** — issue is real but cost of fixing exceeds cost of accepting. Document the trade-off explicitly so the user sees it.
4. **Noise** — reviewer flagged something that's actually correct under context the reviewer didn't have. Note it, move on, and ask: would adding that context to the contract have prevented the false flag?

A fresh reviewer can be wrong because it lacks context. Don't defer just because it's "fresh."

**Executable Probe Enforcement Between Cycles (CMCTS / GroundedPRM Rule):**
Never run two consecutive verbal doubt cycles on a claim or finding that can be tested mechanically. When Cycle 1 surfaces a disputed behavioral, type, concurrency, or boundary assumption, write and run a focused mechanical probe (unit test, `ast-grep` check, compiler check, or reproduction script) before Cycle 2, and append the verified probe output to `CONTRACT` for the next cycle.

### Step 5: STOP — Bounded loop, not recursion

Stop when:

- Next iteration returns only trivial or already-considered findings, **or**
- 3 cycles completed (escalate to user, don't grind a fourth alone), **or**
- User explicitly says "ship it"

If after 3 cycles the reviewer still surfaces substantive issues, the artifact may not be ready. Surface this to the user — three unresolved cycles is information about the artifact, not a reason to keep looping.

If 3 cycles is "obviously insufficient" because the artifact is large: the artifact is too big — return to Step 2 and decompose. Do not lift the bound.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'm confident, skip the doubt step" | Confidence correlates poorly with correctness on novel problems. Moments of certainty are exactly when blind spots hide. |
| "Spawning a reviewer is expensive" | Debugging a wrong commit in production is more expensive. The check is bounded; the bug isn't. |
| "The reviewer will just nitpick" | Only if unscoped. Constrain the prompt to "issues that would make this fail under the contract." |
| "I'll do doubt at the end with `/review`" | `/review` is a final gate. Doubt-driven catches wrong directions early when course-correction is cheap. By PR time it's too late. |
| "If I doubt every step I'll never ship" | The skill applies to consequential decisions, not every keystroke. Re-read "When NOT to Use." |
| "Two opinions are always better than one" | Not when the second has less context and produces noise. Reconcile, don't defer. |
| "The reviewer disagreed so I was wrong" | The reviewer lacks your context — disagreement is information, not verdict. Re-read the artifact, classify, then decide. |
| "Cross-model is always better" | Cross-model catches blind spots a single model shares with itself, but it adds cost and tool fragility. Offer it when the stakes warrant it (hard to reverse, security-sensitive) or when the user asks — mechanical verification is usually the cheaper, stronger check. |
| "User said yes once, so I can keep invoking the CLI" | Each invocation is its own authorization. The artifact, the prompt, and the flags change between calls — re-confirm the exact command with the user before every run. |

## Red Flags

- Spawning a fresh-context reviewer for a one-line rename or formatting change
- Treating reviewer output as authoritative without re-reading the artifact text
- Looping >3 cycles without escalating to the user
- Prompting the reviewer with "is this good?" instead of "find issues"
- Skipping doubt under time pressure on a high-stakes decision
- Re-spawning fresh-context on an unchanged artifact (you'll get the same findings; you're stalling)
- **Doubt theater (checkable signal)**: across 2 or more cycles where the reviewer surfaced substantive findings, zero findings were classified as actionable. You are validating, not doubting. Stop and escalate.
- Doubting only after committing — that's `/review`, not doubt-driven development
- Hardcoding an external CLI invocation without confirming with the user that the tool exists, is configured, and accepts that exact syntax
- **Pausing every doubt cycle to offer cross-model on low-stakes artifacts.** Offer it when stakes warrant it or the user asks; when offered and skipped, say so (*"Proceeding with single-model findings only"*).
- Falling back silently when an external CLI errors or is missing — surface the failure and let the user redirect
- Stripping the contract from the reviewer's input
- Passing the CLAIM to the reviewer (biases toward agreement)

## Interaction with Other Skills

- **`decision-pr-review`**: complementary. `decision-pr-review` is a post-hoc diff/PR audit across decisions, invariants, and code smells; doubt-driven is an in-flight per-decision disproof check. Use both.
- **`advanced-rust-integration` & documentation tools (`context7` / `docs-mcp-server`)**: these verify *facts about crates and frameworks* against resolved source and official docs. Doubt-driven verifies *your reasoning about the artifact* under the contract.
- **`grilling` / `grill-with-docs`**: resolves ambiguous requirements with the user *before* design locks in; doubt-driven stress-tests technical claims *during* implementation.
- **`code-simplification`**: when RECONCILE reveals that a claim fails because the control flow is too tangled to verify, simplify the implementation first and re-verify.
- **Orchestration rule**: this skill orchestrates from the main session; a subagent must not recursively spawn another reviewer subagent.

## Verification

After applying doubt-driven development:

- [ ] Every consequential decision (per the definition above) was named explicitly as a CLAIM before standing
- [ ] At least one fresh-context review per consequential artifact (a failing test written before the fix also satisfies this for behavioral claims)
- [ ] The reviewer received ARTIFACT + CONTRACT — NOT the CLAIM, NOT your reasoning
- [ ] The reviewer's prompt was adversarial ("find issues"), not validating ("is it good")
- [ ] Findings were classified against the artifact text (not rubber-stamped) using the precedence: contract misread / actionable / trade-off / noise
- [ ] A stop condition was met (trivial findings, 3 cycles, or user override)
- [ ] Where the stakes warranted it (hard to reverse, security-sensitive, persistent reviewer disagreement, or user-requested), cross-model was offered and the response was acknowledged in the output
- [ ] In non-interactive mode where an offer would have applied, the skip was announced
- [ ] Any external CLI invocation was preceded by a PATH check, a working-binary test, syntax confirmation with the user, and explicit authorization to run
