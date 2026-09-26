# Emergency Pause Feature: Admin Feedback Survey

- **Audience:** CarbonLedger contract admins, plus on-call engineers and
  support staff who work with the emergency pause.
- **Length:** 18 questions, about 8 minutes.
- **Survey id:** `pause-feature-feedback-v1`. The machine-readable definition is
  [`survey.json`](survey.json).

This is the questionnaire to load into the survey tool; see
[distribution-plan.md](distribution-plan.md). Keep question ids (`q1`…`q18`) as
the column headers of the export so
[`scripts/analyze_pause_survey.py`](../../../scripts/analyze_pause_survey.py)
can read it.

---

## Introduction (shown to respondents)

> We're improving the emergency pause on the CarbonLedger credit and
> marketplace contracts. This short survey asks how well it works for you:
> what's clear, what's confusing, and what you'd change. It takes about 8
> minutes.
>
> Your answers are confidential. Results are reported only in aggregate, and
> open-text answers are quoted without names. We don't ask for key material,
> addresses or incident details, so please don't include any.
> Participation is voluntary, and you can skip any question.

---

## About you

**q1.** What is your role with CarbonLedger?

_Single choice_

- ( ) Contract admin (holds or co-holds an admin key)
- ( ) On-call engineer
- ( ) Support / operations
- ( ) Other

**q2.** How many times have you paused or unpaused a contract (any network) in the last 6 months?

_Single choice_

- ( ) Never
- ( ) 1–2 times
- ( ) 3–5 times
- ( ) 6 or more

**q3.** Have you completed the testnet practice exercise in the admin training guide?

_Single choice_

- ( ) Yes
- ( ) No
- ( ) I didn't know it existed

## Understanding and usability

**q4.** I understand which operations are blocked when each contract is paused.

_Scale 1–5: 1 Strongly disagree · 2 Disagree · 3 Neutral · 4 Agree · 5 Strongly agree_

**q5.** Choosing the pause end time (until_timestamp) is straightforward.

_Scale 1–5: 1 Strongly disagree · 2 Disagree · 3 Neutral · 4 Agree · 5 Strongly agree_

**q6.** The 72-hour maximum pause window is appropriate.

_Scale 1–5: 1 Strongly disagree · 2 Disagree · 3 Neutral · 4 Agree · 5 Strongly agree_

**q7.** I can quickly and confidently tell whether a contract is currently paused.

_Scale 1–5: 1 Strongly disagree · 2 Disagree · 3 Neutral · 4 Agree · 5 Strongly agree_

**q8.** When a pause-related call failed, the error made it clear what went wrong.

_Scale 1–5: 1 Strongly disagree · 2 Disagree · 3 Neutral · 4 Agree · 5 Strongly agree_

**q9.** Having separate pause switches for the credit and marketplace contracts is the right design.

_Scale 1–5: 1 Strongly disagree · 2 Disagree · 3 Neutral · 4 Agree · 5 Strongly agree_

**q10.** In your most recent pause (real or practice), how long did it take from deciding to pause to the pause being confirmed on-chain?

_Single choice_

- ( ) Under 2 minutes
- ( ) 2–5 minutes
- ( ) 5–15 minutes
- ( ) More than 15 minutes
- ( ) I haven't paused yet

## Fit for incidents

**q11.** The pause gave (or would give) me enough control to contain an incident.

_Scale 1–5: 1 Strongly disagree · 2 Disagree · 3 Neutral · 4 Agree · 5 Strongly agree_

**q12.** Which limitations have affected you or worry you? (select all that apply)

_Multiple choice_

- [ ] Contract upgrades are blocked while paused
- [ ] Fees, treasury and project suspension can't be changed while the marketplace is paused
- [ ] No simple way to check whether a contract is paused
- [ ] The reason for a pause isn't recorded anywhere
- [ ] Pausing only the credit contract makes purchases fail with confusing errors
- [ ] The marketplace has a single admin key (no multi-sig)
- [ ] 72 hours is too short for some investigations
- [ ] Users only see raw error codes (#27 / #29)
- [ ] Other

**q13.** Has a pause ever ended (expired) before you expected it to?

_Single choice_

- ( ) Yes
- ( ) No
- ( ) Not sure

## Tooling and training

**q14.** How would you prefer to pause and unpause?

_Single choice_

- ( ) Stellar CLI (current)
- ( ) A button in the admin dashboard
- ( ) A scripted runbook command
- ( ) Multi-signature / governance approval

**q15.** The documentation and training prepared me to use the pause correctly.

_Scale 1–5: 1 Strongly disagree · 2 Disagree · 3 Neutral · 4 Agree · 5 Strongly agree_

**q16.** How likely are you to recommend the current pause process to another admin? (0 = not at all, 10 = extremely likely)

_Scale 0–10_

## Open feedback

**q17.** What was the most confusing or stressful part of using (or learning) the pause?

_Free text, optional_

**q18.** If you could change one thing about the pause feature, what would it be?

_Free text, optional_

---

> Thank you! A summary of the results and the changes we plan will be shared with everyone invited.
