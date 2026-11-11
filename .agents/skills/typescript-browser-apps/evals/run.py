"""Prepare isolated skill tasks or grade their observable results with Node."""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


EVAL_ROOT = Path(__file__).resolve().parent
CASES = json.loads((EVAL_ROOT / "cases.json").read_text(encoding="utf-8"))


def prepare():
    root = Path(tempfile.mkdtemp(prefix="typescript-browser-eval-"))
    tasks = []
    for case in CASES:
        workspace = root / case["id"]
        shutil.copytree(EVAL_ROOT / "fixtures" / case["id"], workspace)
        request = (
            f"Use $typescript-browser-apps at {EVAL_ROOT.parent / 'SKILL.md'}.\n\n"
            f"Work only in {workspace}.\n\n{case['request']}\n\n"
            "Use the workspace's files and the skill's instructions as input. "
            "Keep evaluation harnesses and other workspaces outside your investigation. "
            "Finish with the changes, checks run, and any limitations.\n"
        )
        (workspace / "REQUEST.md").write_text(request, encoding="utf-8")
        tasks.append({"id": case["id"], "workspace": str(workspace), "request": request})
    print(json.dumps({"root": str(root), "tasks": tasks}, indent=2))


def grade(workspace, case_id):
    if not (workspace / "package.json").is_file():
        raise SystemExit(f"Not an evaluation workspace: {workspace}")
    node = shutil.which("node")
    if node is None:
        raise SystemExit("Node with TypeScript type stripping is required.")
    env = {**os.environ, "EVAL_WORKSPACE": str(workspace)}
    result = subprocess.run(
        [node, "--experimental-strip-types", "--test", "--test-timeout=10000",
         str(EVAL_ROOT / "checks" / f"{case_id}.test.mjs")],
        cwd=workspace,
        env=env,
        check=False,
        timeout=30,
    )
    raise SystemExit(result.returncode)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("prepare", help="Create fresh workspaces outside the checkout")
    grader = commands.add_parser("grade", help="Run checks against a completed workspace")
    grader.add_argument("case", choices=[case["id"] for case in CASES])
    grader.add_argument("workspace", type=Path)
    args = parser.parse_args()
    if args.command == "prepare":
        prepare()
    else:
        grade(args.workspace.resolve(), args.case)


if __name__ == "__main__":
    main()
