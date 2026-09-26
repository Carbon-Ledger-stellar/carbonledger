# Pause Controls Usability Testing Report

**Date**: September 2026  
**Participants**: 7 enterprise administrator and operations engineers  
**Methodology**: Moderated remote sessions (recorded with consent) using Figma prototypes and staging dApp environment.

---

## 1. Study Objectives
1. Evaluate whether administrators can swiftly execute an emergency pause during an simulated incident scenario.
2. Determine clarity of duration constraints (maximum 72h limit).
3. Test comprehension of resume/unpause confirmation procedures.
4. Identify ergonomic or workflow friction points.

---

## 2. Participant Summary
- **P1**: Lead DevOps Engineer (Carbon Registry Operator)
- **P2**: Smart Contract Auditor
- **P3**: Compliance & Risk Officer
- **P4**: Treasury Operations Lead
- **P5**: Senior Backend Engineer
- **P6**: Platform Security Lead
- **P7**: On-Call Site Reliability Engineer

---

## 3. Key Usability Metrics

| Task | Completion Rate | Mean Time on Task | Single Ease Question (1-7) |
| :--- | :--- | :--- | :--- |
| **T1**: Locate emergency pause controls | 100% (7/7) | 4.2s | 6.8 |
| **T2**: Execute 6-hour pause with incident reason | 100% (7/7) | 18.5s | 6.5 |
| **T3**: Review active pause status and remaining duration | 100% (7/7) | 5.1s | 6.9 |
| **T4**: Resume operations and confirm unpause | 100% (7/7) | 12.0s | 6.7 |

---

## 4. Key Findings & Usability Recommendations

### Finding 1: Clarity of Hard 72-Hour Contract Expiry Limit
- **Observation**: 2 participants wondered what happens if the investigation exceeds 72 hours.
- **Recommendation**: Add helper text explaining that pauses automatically expire after 72 hours by smart contract design, requiring an administrative extension if mitigation takes longer.
- **Implemented**: Included helper note in `PauseConfirmModal`.

### Finding 2: Prominent Emergency Tone vs Non-Disruptive Maintenance
- **Observation**: Participants appreciated the distinct color differentiation between emergency pause (red/rose) and operational resume (emerald green).
- **Recommendation**: Maintain distinct danger branding for pause triggers to prevent accidental misclicks.

### Finding 3: Keyboard Accessibility
- **Observation**: On-call engineers frequently rely on keyboard shortcuts during incident response.
- **Recommendation**: Support `Escape` to cancel and ensure focus lands immediately on the cancel button to prevent accidental submission.
