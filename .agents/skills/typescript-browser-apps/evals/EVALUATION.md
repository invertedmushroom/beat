# Behavioral evaluation

These three tasks exercise manifest-only deployment, durable draft restoration,
and camera acquisition across disposal. They measure observable artifacts and
state transitions. They do not establish native skill discovery, real browser
installation, or physical camera support.

Use Node with TypeScript type stripping and Python 3. Run from the repository root:

```powershell
rtk proxy python .agents/skills/typescript-browser-apps/evals/run.py prepare
```

The command copies deliberately incomplete fixtures to a new system temporary
directory and prints each workspace and request. Before grading the untouched
manifest fixture, run `rtk npm run build` from its workspace. Grade all untouched
fixtures to establish that the checks detect failures:

```powershell
rtk proxy python .agents/skills/typescript-browser-apps/evals/run.py grade manifest <manifest-workspace>
rtk proxy python .agents/skills/typescript-browser-apps/evals/run.py grade storage <storage-workspace>
rtk proxy python .agents/skills/typescript-browser-apps/evals/run.py grade camera <camera-workspace>
```

Give each request to a separate fresh-context agent. Supply the skill and that
workspace only. Keep `checks/` and prior conclusions outside the agent's input.
Agents may add their own focused checks in the workspace.

After each agent finishes, grade the same workspace again. The manifest task must
run its build before artifact grading. Review each agent's diff and final report
as well as the checks. Verify that the agent applied relevant skill branches,
preserved the requested scope, and reported browser limitations. A passing
deterministic check cannot establish those reporting properties.

Use a new `prepare` run for each independent evaluation. Keep fixture source
unchanged when inspecting generated solutions. A failed solution warrants a skill
change only when the observed failure reveals missing or misleading guidance.

## Recorded run: 2026-10-29

Each task used an independent agent with no parent conversation. The agents read
the skill and their assigned workspace. The parent ran the grading checks and
reviewed the generated source, contracts, and final reports.

| Task | Untouched fixture failures | Final passing checks |
|---|---|---|
| Manifest-only deployment | 1 of 2 | 2 of 2 |
| Durable draft restoration and autosave | 3 of 5 | 5 of 5 |
| Camera acquisition and disposal | 5 of 6 | 6 of 6 |

Review of the first manifest solution exposed an omitted app-identity check.
That solution added `id: "./"` and treated the ID as relative to the manifest.
The grader was strengthened to apply the manifest specification's origin-based
ID resolution. The first solution then failed because its identity changed from
`/field/` to `/`. The skill's installation guidance now explains ID resolution
and preservation. A fresh agent repeated the same task and passed with
`id: "/field/"`.

Storage and camera solutions passed their independent checks on the first run.
All final reports distinguished automated artifact or port-stub checks from
unverified browser and device behavior. Generated solutions remained in temporary
workspaces. Coverage is limited to these three synthetic tasks. Native skill
discovery, real browser installation, physical camera behavior, and full
TypeScript compiler checks were outside this run.

## Follow-up verification: 2026-10-29

The manifest grader now checks `display: "standalone"` independently from the
requested metadata. A deliberate built-artifact mutation to `display: "browser"`
failed that check while the other two checks still passed. Rebuilding the
unchanged source restored all three checks.

A new prepare run supplied the same three requests to independent fresh-context
agents. Each agent received only the skill, relevant references and its fixture
workspace. The parent graded untouched fixtures before dispatch, graded the
completed workspaces, and reviewed generated source, contracts and final reports.

| Task | Untouched fixture failures | Final passing checks |
|---|---|---|
| Manifest-only deployment | 1 of 3 | 3 of 3 |
| Durable draft restoration and autosave | 3 of 5 | 5 of 5 |
| Camera acquisition and disposal | 5 of 6 | 6 of 6 |

The generated storage and camera implementations also passed the repository's
TypeScript compiler with `--noEmit --strict --target ES2024 --module NodeNext
--moduleResolution NodeNext --skipLibCheck`. Each agent preserved the requested
scope and reported unverified browser/device behavior. The manifest solution
retained installed-window presentation and app identity without adding a worker.
The storage solution preserved incompatible data through load-then-autosave.
The camera solution released obsolete acquisitions without disturbing replacements.

These are synthetic artifact and port-stub checks, not certification of native
skill discovery, real browser installation, physical camera behavior, or every
branch of the skill.
