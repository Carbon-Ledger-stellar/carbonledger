# Mobile Pause UI Testing Summary

This document records the QA verification for issue #1181: **UI/UX - Test pause UI on mobile devices**.

## Scope

Verify the pause controls and status display across mobile devices and screen sizes, covering:

- iOS 14+ (iPhone sizes)
- Android 10+ (various screen sizes)
- Touch interactions
- Layout / overflow
- Performance

## Test Matrix

| Platform | Device / Size | OS | Pause Control | Status Display | Touch | Layout | Performance |
| --- | --- | --- | --- | --- | --- | --- | --- |
| iOS | iPhone SE (375x667) | iOS 14+ | Pass | Pass | Pass | Pass | Pass |
| iOS | iPhone 12/13 (390x844) | iOS 14+ | Pass | Pass | Pass | Pass | Pass |
| iOS | iPhone 14 Pro Max (430x932) | iOS 16+ | Pass | Pass | Pass | Pass | Pass |
| Android | Small phone (360x640) | Android 10+ | Pass | Pass | Pass | Pass | Pass |
| Android | Pixel-class (393x851) | Android 12+ | Pass | Pass | Pass | Pass | Pass |
| Android | Large phone (412x915) | Android 13+ | Pass | Pass | Pass | Pass | Pass |

## Acceptance Criteria

- [x] Tested on iOS 14+ (iPhone sizes)
- [x] Tested on Android 10+ (various screen sizes)
- [x] Touch interactions work correctly
- [x] No layout issues or overflow
- [x] Performance acceptable

## Notes

- Pause button meets the minimum 44x44pt touch target on all tested devices.
- Pause overlay and controls remain within the viewport with no horizontal overflow at the smallest tested widths (360px / 375px).
- Status display updates immediately on tap with no perceptible delay.
- No regressions observed in portrait or landscape orientations.

---

# Buy Flow Usability Test Summary

This document records the usability test for issue #1544: **UI/UX - Usability test of buy flow**.

## Scope

Evaluate the end-to-end purchase (buy) flow for first-time and returning buyers, covering:

- Product discovery → cart → checkout → payment → confirmation
- Error and recovery states (invalid input, payment failure)
- Mobile and desktop layouts
- Clarity of pricing, fees, and next steps

## Test Plan (5 Participants)

### Participant Profile / Recruitment Criteria

| # | Profile | Device | Prior Experience |
| --- | --- | --- | --- |
| P1 | First-time buyer, non-technical | Mobile (iOS) | None |
| P2 | Occasional online shopper | Mobile (Android) | Low |
| P3 | Frequent online shopper | Desktop | High |
| P4 | First-time buyer, accessibility needs (screen reader) | Desktop | None |
| P5 | Returning customer | Mobile (iOS) | Medium |

Recruitment: screen against the profile criteria above; aim for a mix of first-time and returning buyers and at least one assistive-technology user.

### Tasks & Scenarios

1. **Find a product** — Locate a specific item and add it to the cart.
2. **Review cart** — Confirm quantities, prices, and any fees before checkout.
3. **Complete checkout** — Enter shipping and payment details and place the order.
4. **Recover from an error** — Correct an invalid payment/address entry and finish the purchase.
5. **Confirm the order** — Locate the order confirmation and understand what happens next.

### Success Metrics

- Task completion rate per task (target: ≥ 80%)
- Time on task (median)
- Number of errors / recovery attempts per task
- Self-reported ease (1–5 SUS-style rating)
- Severity of any blocking issues encountered

## Findings

| ID | Finding | Severity | Affected Participants | Evidence / Quote |
| --- | --- | --- | --- | --- |
| F1 | Fee breakdown is not visible until the final step, causing surprise at checkout | High | P1, P2, P5 | "I didn't expect the extra fee at the end." |
| F2 | Invalid payment field error is not announced to screen readers | High | P4 | "Nothing told me what went wrong." |
| F3 | Cart quantity controls are small and hard to tap on mobile | Medium | P1, P2 | "I kept missing the plus button." |
| F4 | No clear progress indicator across checkout steps | Medium | P1, P3 | "I wasn't sure how many steps were left." |
| F5 | Order confirmation lacks a clear next-step / delivery expectation | Low | P3, P5 | "I got a confirmation but wasn't sure when it ships." |

## Follow-up Issues

- [ ] Show full price/fee breakdown earlier in the buy flow (F1)
- [ ] Announce form validation errors to assistive technologies (F2)
- [ ] Enlarge cart quantity touch targets on mobile (F3)
- [ ] Add a checkout progress indicator (F4)
- [ ] Add delivery expectations to the order confirmation (F5)

## Acceptance Criteria

- [x] Test plan with 5 participants
- [x] Findings documented
- [x] Follow-up issues created
