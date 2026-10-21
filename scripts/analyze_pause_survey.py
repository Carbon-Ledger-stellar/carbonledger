#!/usr/bin/env python3
"""Analyze pause feature feedback survey responses and write a Markdown report (#1327).

Input is a CSV export from the survey tool with one column per question id
(q1 … q18); other columns (timestamp, email, …) are ignored. Answers may use
either the option keys or the option labels from survey.json:

  single   one option                        e.g. "admin" or "Contract admin (…)"
  multi    options separated by ";"          (Google Forms' ", " also works)
  likert   1–5 or the likert label           e.g. "4" or "Agree"
  nps      0–10
  text     free text

Run:
  python3 scripts/analyze_pause_survey.py responses.csv --invited 12 --out report.md
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from statistics import mean

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SURVEY = REPO_ROOT / "docs" / "pause-feature" / "feedback-survey" / "survey.json"

# Below this many responses, results are reported with a low-confidence note.
LOW_N = 5
PRIORITY_ORDER = {"high": 0, "medium": 1, "low": 2}


@dataclass
class Question:
    id: str
    type: str
    text: str
    options: dict[str, str] = field(default_factory=dict)
    segment: bool = False


def load_survey(path: Path) -> tuple[dict, list[Question]]:
    survey = json.loads(path.read_text())
    questions = [
        Question(
            id=q["id"],
            type=q["type"],
            text=q["text"],
            options=q.get("options", {}),
            segment=q.get("segment", False),
        )
        for section in survey["sections"]
        for q in section["questions"]
    ]
    return survey, questions


# ── Parsing ──────────────────────────────────────────────────────────────────


def _option_key(q: Question, raw: str) -> str | None:
    raw = raw.strip()
    if raw in q.options:
        return raw
    for key, label in q.options.items():
        if raw.lower() == label.lower():
            return key
    return None


def parse_choice(q: Question, raw: str) -> str | None:
    return _option_key(q, raw) if raw.strip() else None


def parse_multi(q: Question, raw: str) -> list[str]:
    raw = raw.strip()
    if not raw:
        return []
    parts = [p for p in (s.strip() for s in raw.split(";")) if p]
    keys = [k for k in (_option_key(q, p) for p in parts) if k]
    if len(keys) == len(parts):
        return keys
    # Comma-separated exports: labels may themselves contain commas, so match
    # each known key/label as a substring instead of splitting.
    lowered = raw.lower()
    return [k for k, label in q.options.items() if label.lower() in lowered or k in parts]


def parse_likert(raw: str, labels: list[str]) -> int | None:
    raw = raw.strip()
    if not raw:
        return None
    if raw.isdigit() and 1 <= int(raw) <= 5:
        return int(raw)
    for i, label in enumerate(labels, start=1):
        if raw.lower() == label.lower():
            return i
    return None


def parse_nps(raw: str) -> int | None:
    raw = raw.strip()
    if raw.isdigit() and 0 <= int(raw) <= 10:
        return int(raw)
    return None


def load_responses(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as fh:
        return [{k.strip(): (v or "") for k, v in row.items() if k} for row in csv.DictReader(fh)]


# ── Analysis ─────────────────────────────────────────────────────────────────


def analyze(survey: dict, questions: list[Question], rows: list[dict[str, str]]) -> dict:
    labels = survey["likert_labels"]
    segment_q = next((q for q in questions if q.segment), None)
    result: dict = {"n": len(rows), "questions": {}}

    for q in questions:
        answers = [row.get(q.id, "") for row in rows]
        if q.type == "likert":
            values = [v for v in (parse_likert(a, labels) for a in answers) if v is not None]
            by_segment: dict[str, list[int]] = defaultdict(list)
            if segment_q:
                for row in rows:
                    v = parse_likert(row.get(q.id, ""), labels)
                    seg = parse_choice(segment_q, row.get(segment_q.id, ""))
                    if v is not None and seg:
                        by_segment[seg].append(v)
            result["questions"][q.id] = {
                "n": len(values),
                "mean": mean(values) if values else None,
                "agree": _share(sum(v >= 4 for v in values), len(values)),
                "disagree": _share(sum(v <= 2 for v in values), len(values)),
                "distribution": [values.count(i) for i in range(1, 6)],
                "by_segment": {k: mean(v) for k, v in sorted(by_segment.items())},
            }
        elif q.type == "single":
            keys = [k for k in (parse_choice(q, a) for a in answers) if k]
            result["questions"][q.id] = {"n": len(keys), "counts": Counter(keys)}
        elif q.type == "multi":
            picked = [parse_multi(q, a) for a in answers]
            answered = [p for p in picked if p]
            result["questions"][q.id] = {
                "n": len(answered),
                "counts": Counter(k for p in answered for k in p),
            }
        elif q.type == "nps":
            scores = [s for s in (parse_nps(a) for a in answers) if s is not None]
            promoters = sum(s >= 9 for s in scores)
            detractors = sum(s <= 6 for s in scores)
            result["questions"][q.id] = {
                "n": len(scores),
                "promoters": promoters,
                "passives": len(scores) - promoters - detractors,
                "detractors": detractors,
                "nps": round(100 * (promoters - detractors) / len(scores)) if scores else None,
            }
        elif q.type == "text":
            texts = [a.strip() for a in answers if a.strip()]
            result["questions"][q.id] = {"n": len(texts), "responses": texts}
        else:
            raise ValueError(f"Unknown question type {q.type!r} for {q.id}")

    return result


def _share(count: int, total: int) -> float | None:
    return count / total if total else None


def recommendations(survey: dict, analysis: dict) -> list[dict]:
    """Evaluate survey.json recommendation_rules against the analysis."""
    triggered: list[dict] = []
    for rule in survey.get("recommendation_rules", []):
        stats = analysis["questions"].get(rule["question"])
        if not stats or not stats["n"]:
            continue
        evidence = None
        metric = rule.get("metric")
        value = stats.get(metric) if metric else None
        if metric == "mean" and value is not None and value < rule["below"]:
            evidence = f"{rule['question']} mean {value:.2f} < {rule['below']}"
        elif metric == "nps" and value is not None and value < rule["below"]:
            evidence = f"{rule['question']} NPS {value} < {rule['below']}"
        elif "option" in rule:
            share = stats["counts"].get(rule["option"], 0) / stats["n"]
            if share >= rule["share_at_least"]:
                evidence = (
                    f"{rule['question']} '{rule['option']}' chosen by {share:.0%} "
                    f"(≥ {rule['share_at_least']:.0%})"
                )
        if evidence:
            triggered.append({**rule, "evidence": evidence})

    # Several rules can point to the same change; merge their evidence.
    merged: dict[str, dict] = {}
    for r in triggered:
        if r["recommendation"] in merged:
            existing = merged[r["recommendation"]]
            existing["evidence"] += f"; {r['evidence']}"
            if PRIORITY_ORDER[r["priority"]] < PRIORITY_ORDER[existing["priority"]]:
                existing["priority"] = r["priority"]
        else:
            merged[r["recommendation"]] = dict(r)
    return sorted(merged.values(), key=lambda r: PRIORITY_ORDER[r["priority"]])


# ── Report ───────────────────────────────────────────────────────────────────


def _pct(v: float | None) -> str:
    return "—" if v is None else f"{v:.0%}"


def _bar(counts: list[int]) -> str:
    return " · ".join(str(c) for c in counts)


def render(survey: dict, questions: list[Question], analysis: dict, invited: int | None) -> str:
    n = analysis["n"]
    stats = analysis["questions"]
    out = [f"# {survey['title']}: Results", ""]

    out += ["## Summary", ""]
    rate = f" of {invited} invited ({n / invited:.0%})" if invited else ""
    out.append(f"- Responses: **{n}**{rate}")
    if n < LOW_N:
        out.append(f"- ⚠️ Fewer than {LOW_N} responses: treat percentages as anecdotal.")
    nps_q = next((q for q in questions if q.type == "nps"), None)
    if nps_q and stats[nps_q.id]["nps"] is not None:
        out.append(f"- Net promoter score ({nps_q.id}): **{stats[nps_q.id]['nps']}**")
    likert = [q for q in questions if q.type == "likert" and stats[q.id]["mean"] is not None]
    if likert:
        lowest = min(likert, key=lambda q: stats[q.id]["mean"])
        highest = max(likert, key=lambda q: stats[q.id]["mean"])
        for label, q in (("Strongest", highest), ("Weakest", lowest)):
            out.append(f"- {label} agreement: {q.id} ({stats[q.id]['mean']:.2f}): {q.text}")
    out.append("")

    if likert:
        segment_q = next((q for q in questions if q.segment), None)
        out += [
            "## Agreement (1 = strongly disagree … 5 = strongly agree)",
            "",
            "| Q | Statement | n | Mean | Agree | Disagree | 1 · 2 · 3 · 4 · 5 |",
            "|---|---|---|---|---|---|---|",
        ]
        for q in likert:
            s = stats[q.id]
            out.append(
                f"| {q.id} | {q.text} | {s['n']} | {s['mean']:.2f} | {_pct(s['agree'])} | "
                f"{_pct(s['disagree'])} | {_bar(s['distribution'])} |"
            )
        out.append("")
        segments = sorted({seg for q in likert for seg in stats[q.id]["by_segment"]})
        if segment_q and len(segments) > 1:
            out += [f"### Mean agreement by {segment_q.id} ({segment_q.text.rstrip('?')})", ""]
            out.append("| Q | " + " | ".join(segment_q.options.get(s, s) for s in segments) + " |")
            out.append("|---|" + "---|" * len(segments))
            for q in likert:
                cells = [
                    f"{stats[q.id]['by_segment'][s]:.2f}" if s in stats[q.id]["by_segment"] else "—"
                    for s in segments
                ]
                out.append(f"| {q.id} | " + " | ".join(cells) + " |")
            out.append("")

    choice = [q for q in questions if q.type in ("single", "multi")]
    if choice:
        out += ["## Choice questions", ""]
        for q in choice:
            s = stats[q.id]
            note = " (multiple answers allowed; % of respondents)" if q.type == "multi" else ""
            out += [f"### {q.id}. {q.text}{note}", "", "| Answer | Count | % |", "|---|---|---|"]
            for key, label in sorted(q.options.items(), key=lambda kv: -s["counts"].get(kv[0], 0)):
                count = s["counts"].get(key, 0)
                out.append(f"| {label} | {count} | {_pct(_share(count, s['n']))} |")
            out += ["", f"_{s['n']} answered._", ""]

    if nps_q:
        s = stats[nps_q.id]
        out += [
            f"## Recommendation score ({nps_q.id})",
            "",
            f"{nps_q.text}",
            "",
            "| Promoters (9–10) | Passives (7–8) | Detractors (0–6) | NPS |",
            "|---|---|---|---|",
            f"| {s['promoters']} | {s['passives']} | {s['detractors']} | "
            f"{'—' if s['nps'] is None else s['nps']} |",
            "",
        ]

    texts = [q for q in questions if q.type == "text"]
    if texts:
        out += ["## Open feedback", ""]
        for q in texts:
            out += [f"### {q.id}. {q.text}", ""]
            responses = stats[q.id]["responses"]
            out += [f"- {r.replace(chr(10), ' ')}" for r in responses] or ["_No responses._"]
            out.append("")

    recs = recommendations(survey, analysis)
    out += ["## Improvement recommendations", ""]
    if recs:
        out += ["| Priority | Recommendation | Evidence |", "|---|---|---|"]
        out += [f"| {r['priority']} | {r['recommendation']} | {r['evidence']} |" for r in recs]
    else:
        out.append("_No recommendation thresholds were crossed._")
    out += [
        "",
        "Recommendations are generated from the thresholds in `survey.json`. Review them",
        "against the open feedback above before adding them to the roadmap.",
        "",
    ]
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("responses", type=Path, help="CSV export of survey responses")
    parser.add_argument(
        "--survey", type=Path, default=DEFAULT_SURVEY, help="survey definition JSON"
    )
    parser.add_argument("--invited", type=int, help="number of people invited (for response rate)")
    parser.add_argument("--out", type=Path, help="write the report here instead of stdout")
    args = parser.parse_args(argv)

    survey, questions = load_survey(args.survey)
    rows = load_responses(args.responses)
    report = render(survey, questions, analyze(survey, questions, rows), args.invited)
    if args.out:
        args.out.write_text(report, encoding="utf-8")
        print(f"Wrote {args.out} ({len(rows)} responses)", file=sys.stderr)
    else:
        print(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
