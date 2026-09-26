# Pause Feedback Survey: Distribution Plan

How to run [survey.md](survey.md) with admin users and turn the answers into
the feedback report.

## Who to invite

| Group | Why | Source |
|---|---|---|
| Contract admins (primary) | They use the pause | Holders of the admin role on `carbon_credit` (`get_role` / `has_role`) and the `carbon_marketplace` admin |
| On-call engineers | They'd trigger a pause in an incident | On-call rotation in [runbooks/contacts.md](../../runbooks/contacts.md) |
| Support / operations | They field user questions during a pause | Support team list |

Record the number invited; the analysis uses it for the response rate
(`--invited`). If fewer than about 5 admins exist, still run the survey, but
treat it as structured interviews. The report flags small samples.

## Tool setup

1. Create the form in the team's survey tool (Google Forms, Typeform, or
   similar) from [survey.md](survey.md), keeping question wording and option
   labels exactly as written. Answers can then be matched to
   [survey.json](survey.json) by label.
2. Title each question with its id, or rename the export columns to `q1`…`q18`
   before analysis.
3. Turn **off** email collection and sign-in requirements, unless needed to
   prevent duplicate submissions. If so, drop those columns before sharing
   the export.
4. Before sending, submit one test response and run the analysis on it
   (see below) to check the column mapping.

## Timeline

| Day | Step |
|---|---|
| 0 | Send the invitation (template below) |
| 4 | Reminder to non-respondents |
| 7 | Final reminder |
| 10 | Close the survey, export the CSV |
| 10–12 | Run the analysis, draft the feedback report |
| 14 | Review the report and recommendations with admins; agree follow-up issues |

Avoid sending during an active incident or right after one. Answers will
skew towards that single experience.

## Invitation template

> **Subject:** 8-minute survey: how well does the emergency pause work for you?
>
> Hi,
>
> We're reviewing the emergency pause on the credit and marketplace contracts
> and want to hear from the people who would use it. The survey has 18
> questions and takes about 8 minutes: [link]
>
> Answers are confidential and reported only in aggregate. Please don't include
> keys, addresses or incident details. It closes on [date].
>
> Thanks!

Reminders reuse the same text with "Reminder:" in the subject.

## Privacy

- Don't collect names, emails or wallet addresses in the form.
- Keep the raw CSV in the team's private drive, **not in this repository**.
- In the report, quote open-text answers only after removing anything that
  identifies a person, incident or address.

## Analysis and report

```bash
python3 scripts/analyze_pause_survey.py responses.csv --invited 12 --out pause-survey-report.md
```

The generated report contains:

- response rate
- agreement scores, overall and by role
- choice breakdowns and the recommendation score
- all open answers
- **improvement recommendations**: the rules in `survey.json` whose thresholds were crossed, with the evidence for each

To finish the feedback report:

1. Read the open answers and add a short **Themes** section: 3–5 recurring points, each with a count.
2. Check each generated recommendation against the themes. Keep, reword, or drop it, and note why.
3. Compare with [baseline-recommendations.md](baseline-recommendations.md). Mark which baseline items the survey confirmed or contradicted.
4. Open one issue per accepted recommendation and link them from the report.
5. Share the report with everyone invited, as promised in the survey outro.

Tests for the analysis script:
`python3 -m unittest scripts/test_analyze_pause_survey.py`
