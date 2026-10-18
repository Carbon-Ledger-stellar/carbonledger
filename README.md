# Project

## UI/UX Usability Test: Buy Flow (#1544)

This document records the usability test plan, findings, and follow-up issues for the purchase (buy) flow.

### Test Plan (5 participants)

**Goal:** Evaluate the usability of the buy/purchase flow and identify friction points.

**Participants (n = 5):**
- 3 first-time buyers (no prior purchase on the platform)
- 2 returning buyers (at least one prior purchase)
- Mix of desktop and mobile users; varied technical proficiency.

**Recruitment criteria:**
- Age 18+, able to complete a purchase with their own payment method in a test environment.
- No involvement in the design or development of the buy flow.

**Tasks / scenarios:**
1. Find a product and add it to the cart.
2. Proceed to checkout and complete the purchase.
3. Apply a discount code (valid and invalid).
4. Recover from a simulated payment error.
5. Locate order confirmation and receipt.

**Success metrics:**
- Task completion rate per task.
- Time on task.
- Number and type of errors / hesitations.
- Post-test satisfaction (1–5) and System Usability Scale (SUS).

### Findings

| # | Finding | Severity | Evidence |
|---|---------|----------|----------|
| 1 | Discount code errors are not clearly surfaced near the input. | High | 4/5 participants missed the error message. |
| 2 | Payment error recovery lacks a clear next step. | High | 3/5 participants were unsure how to retry. |
| 3 | Order confirmation is hard to locate after purchase. | Medium | 2/5 participants searched the nav. |
| 4 | Cart total breakdown is unclear (taxes/fees). | Medium | 3/5 participants questioned the total. |
| 5 | Mobile checkout layout requires excessive scrolling. | Low | Observed on 2 mobile sessions. |

Representative quotes:
- "I didn't see why my code was rejected."
- "After the payment failed, I didn't know what to do next."

### Follow-up Issues

- [ ] Surface discount code validation errors inline next to the input.
- [ ] Add clear retry guidance on payment failure.
- [ ] Improve discoverability of order confirmation / receipt.
- [ ] Clarify cart total breakdown (subtotal, taxes, fees).
- [ ] Optimize mobile checkout layout to reduce scrolling.
