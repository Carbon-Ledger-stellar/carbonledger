"""Tests for analyze_pause_survey.py (#1327).

Run: python3 -m unittest scripts/test_analyze_pause_survey.py

All response data below is synthetic test input, not real survey results.
"""

from __future__ import annotations

import csv
import io
import re
import sys
import tempfile
import unittest
import unittest.mock
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import analyze_pause_survey as aps  # noqa: E402

SURVEY_DIR = aps.REPO_ROOT / "docs" / "pause-feature" / "feedback-survey"


def write_csv(rows: list[dict[str, str]]) -> Path:
    tmp = tempfile.NamedTemporaryFile(
        "w", suffix=".csv", delete=False, newline="", encoding="utf-8"
    )
    fields = sorted({k for r in rows for k in r}, key=lambda k: (len(k), k))
    writer = csv.DictWriter(tmp, fieldnames=["Timestamp", *fields])
    writer.writeheader()
    for r in rows:
        writer.writerow({"Timestamp": "2026-10-01 10:00", **r})
    tmp.close()
    return Path(tmp.name)


def synthetic_rows() -> list[dict[str, str]]:
    base = {
        "q2": "1-2", "q3": "yes", "q4": "4", "q5": "4", "q6": "4", "q7": "2", "q8": "2",
        "q9": "4", "q10": "2-5", "q11": "4", "q13": "no", "q14": "dashboard", "q15": "4",
    }
    no_status_label = "No simple way to check whether a contract is paused"
    return [
        {
            **base,
            "q1": "admin",
            "q12": "no_status_query;upgrade_blocked",
            "q16": "9",
            "q17": "Checking status",
        },
        {**base, "q1": "admin", "q12": no_status_label, "q16": "6", "q7": "1"},
        {**base, "q1": "oncall", "q12": "user_messaging", "q16": "8", "q8": "Strongly disagree"},
        {**base, "q1": "Support / operations", "q12": "", "q16": "10", "q18": "A dashboard button"},
        {**base, "q1": "oncall", "q12": "no_status_query", "q16": "3", "q14": "cli"},
    ]


class SurveyDefinitionTest(unittest.TestCase):
    def setUp(self):
        self.survey, self.questions = aps.load_survey(aps.DEFAULT_SURVEY)

    def test_has_15_to_20_questions_with_unique_ids(self):
        ids = [q.id for q in self.questions]
        self.assertGreaterEqual(len(ids), 15)
        self.assertLessEqual(len(ids), 20)
        self.assertEqual(len(ids), len(set(ids)))

    def test_questionnaire_markdown_matches_definition(self):
        md = (SURVEY_DIR / "survey.md").read_text()
        md_ids = re.findall(r"^\*\*(q\d+)\.\*\*", md, flags=re.MULTILINE)
        self.assertEqual(md_ids, [q.id for q in self.questions])
        for q in self.questions:
            self.assertIn(q.text, md, f"{q.id} text differs between survey.md and survey.json")
            for label in q.options.values():
                self.assertIn(label, md, f"{q.id} option {label!r} missing from survey.md")

    def test_rules_reference_real_questions_and_options(self):
        by_id = {q.id: q for q in self.questions}
        for rule in self.survey["recommendation_rules"]:
            q = by_id[rule["question"]]
            self.assertIn(rule["priority"], aps.PRIORITY_ORDER)
            if "option" in rule:
                self.assertIn(rule["option"], q.options)
            else:
                self.assertIn(rule["metric"], ("mean", "nps"))


class ParsingTest(unittest.TestCase):
    def setUp(self):
        _, questions = aps.load_survey(aps.DEFAULT_SURVEY)
        self.q = {q.id: q for q in questions}
        self.labels = aps.load_survey(aps.DEFAULT_SURVEY)[0]["likert_labels"]

    def test_likert_accepts_numbers_and_labels(self):
        self.assertEqual(aps.parse_likert("4", self.labels), 4)
        self.assertEqual(aps.parse_likert("strongly agree", self.labels), 5)
        self.assertIsNone(aps.parse_likert("7", self.labels))
        self.assertIsNone(aps.parse_likert("", self.labels))

    def test_multi_accepts_keys_labels_and_comma_exports(self):
        q12 = self.q["q12"]
        self.assertEqual(
            aps.parse_multi(q12, "no_reason;upgrade_blocked"), ["no_reason", "upgrade_blocked"]
        )
        comma = (
            "Fees, treasury and project suspension can't be changed while the marketplace is "
            "paused, "
            "The reason for a pause isn't recorded anywhere"
        )
        self.assertEqual(
            sorted(aps.parse_multi(q12, comma)), ["admin_setters_blocked", "no_reason"]
        )
        self.assertEqual(aps.parse_multi(q12, ""), [])

    def test_nps_range(self):
        self.assertEqual(aps.parse_nps("0"), 0)
        self.assertEqual(aps.parse_nps("10"), 10)
        self.assertIsNone(aps.parse_nps("11"))


class AnalysisTest(unittest.TestCase):
    def setUp(self):
        self.survey, self.questions = aps.load_survey(aps.DEFAULT_SURVEY)
        path = write_csv(synthetic_rows())
        self.addCleanup(path.unlink)
        self.analysis = aps.analyze(self.survey, self.questions, aps.load_responses(path))

    def test_likert_statistics(self):
        q7 = self.analysis["questions"]["q7"]
        self.assertEqual(q7["n"], 5)
        self.assertAlmostEqual(q7["mean"], 1.8)
        self.assertEqual(q7["distribution"], [1, 4, 0, 0, 0])
        self.assertEqual(q7["disagree"], 1.0)
        self.assertEqual(self.analysis["questions"]["q7"]["by_segment"]["admin"], 1.5)

    def test_choice_counts_accept_labels(self):
        self.assertEqual(self.analysis["questions"]["q1"]["counts"]["support"], 1)
        q12 = self.analysis["questions"]["q12"]
        self.assertEqual(q12["n"], 4)  # blank answers are not respondents for this question
        self.assertEqual(q12["counts"]["no_status_query"], 3)

    def test_nps(self):
        nps = self.analysis["questions"]["q16"]
        self.assertEqual((nps["promoters"], nps["passives"], nps["detractors"]), (2, 1, 2))
        self.assertEqual(nps["nps"], 0)

    def test_recommendations_merge_and_sort(self):
        recs = aps.recommendations(self.survey, self.analysis)
        self.assertEqual(recs[0]["priority"], "high")
        status = [r for r in recs if "is_paused()" in r["recommendation"]]
        # The q7 mean rule and the q12 no_status_query rule share one
        # recommendation, so they merge into a single row with both pieces of evidence.
        self.assertEqual(len(status), 1)
        self.assertIn("q7 mean 1.80", status[0]["evidence"])
        self.assertIn("q12 'no_status_query' chosen by 75%", status[0]["evidence"])
        dashboard = [
            r for r in recs if "admin dashboard." in r["recommendation"] and r["question"] == "q14"
        ]
        self.assertEqual(len(dashboard), 1)
        self.assertFalse(any("NPS" in r["evidence"] for r in recs))  # NPS 0 is not < 0

    def test_no_recommendations_when_everything_is_fine(self):
        agree = {q: "5" for q in ("q4", "q5", "q6", "q7", "q8", "q15")}
        happy = [{"q1": "admin", "q16": "10", **agree}]
        path = write_csv(happy)
        self.addCleanup(path.unlink)
        analysis = aps.analyze(self.survey, self.questions, aps.load_responses(path))
        self.assertEqual(aps.recommendations(self.survey, analysis), [])


class ReportTest(unittest.TestCase):
    def test_cli_renders_full_report(self):
        path = write_csv(synthetic_rows())
        self.addCleanup(path.unlink)
        buf = io.StringIO()
        with redirect_stdout(buf):
            self.assertEqual(aps.main([str(path), "--invited", "10"]), 0)
        report = buf.getvalue()
        for heading in (
            "## Summary",
            "## Agreement",
            "### Mean agreement by q1",
            "## Choice questions",
            "## Recommendation score (q16)",
            "## Open feedback",
            "## Improvement recommendations",
        ):
            self.assertIn(heading, report)
        self.assertIn("Responses: **5** of 10 invited (50%)", report)
        self.assertIn("- Checking status", report)
        self.assertIn("Weakest agreement: q7", report)

    def test_low_response_warning_and_out_file(self):
        path = write_csv(synthetic_rows()[:2])
        self.addCleanup(path.unlink)
        out = Path(tempfile.mkdtemp()) / "report.md"
        with redirect_stdout(io.StringIO()), unittest.mock.patch("sys.stderr", io.StringIO()):
            aps.main([str(path), "--out", str(out)])
        self.assertIn("Fewer than 5 responses", out.read_text())


if __name__ == "__main__":
    unittest.main()
