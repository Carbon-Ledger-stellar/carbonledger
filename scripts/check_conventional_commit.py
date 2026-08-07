#!/usr/bin/env python3
"""Enforce Conventional Commits (https://www.conventionalcommits.org) format.

Used as a pre-commit `commit-msg` stage hook (issue #647) — pre-commit
passes the path to the commit message file as argv[1] — and directly by CI
against every commit on a PR branch.

Format: `<type>(<optional scope>)!: <description>`
"""

import re
import sys

TYPES = [
    "feat",
    "fix",
    "docs",
    "style",
    "refactor",
    "perf",
    "test",
    "build",
    "ci",
    "chore",
    "revert",
]

# type(scope)!: description   — scope and `!` (breaking change) are optional.
PATTERN = re.compile(rf"^({'|'.join(TYPES)})(\([a-zA-Z0-9/_.\-]+\))?!?: .{{1,}}")

# Auto-generated messages that should never be blocked.
ALLOWED_PREFIXES = (
    "Merge ",
    "Revert \"",
    "fixup!",
    "squash!",
)


def is_valid(subject: str) -> bool:
    subject = subject.strip()
    if not subject:
        return False
    if subject.startswith(ALLOWED_PREFIXES):
        return True
    return bool(PATTERN.match(subject))


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: check_conventional_commit.py <commit-msg-file>", file=sys.stderr)
        return 2

    with open(argv[1], "r", encoding="utf-8") as f:
        lines = f.readlines()

    # First non-comment line is the subject.
    subject = ""
    for line in lines:
        if line.strip().startswith("#"):
            continue
        subject = line.rstrip("\n")
        break

    if is_valid(subject):
        return 0

    print(
        "Commit message does not follow Conventional Commits format:\n\n"
        f"  {subject!r}\n\n"
        f"Expected: <type>(<optional scope>)!: <description>\n"
        f"Allowed types: {', '.join(TYPES)}\n\n"
        "Examples:\n"
        "  feat(marketplace): add bulk purchase discount tiers\n"
        "  fix: correct off-by-one in serial range validation\n"
        "  docs(benchmarking): document regression threshold\n",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
