# Emergency Pause: Training Materials

Training for the emergency pause on the `carbon_credit` and
`carbon_marketplace` contracts (`pause_operations` / `unpause_operations`).

| Material | Audience | Use it for |
|---|---|---|
| [Admin training guide](admin-training-guide.md) | Admins / on-call | When to pause, step-by-step procedures, checklist, testnet practice exercise |
| [Video tutorial script](video-tutorial-script.md) | Admins | Recording script (~8 min) for the admin video walkthrough |
| [User FAQ](user-faq.md) | Users, support | What a pause means for users, the errors they see, whether they were charged |
| [Troubleshooting guide](troubleshooting.md) | Admins, support, on-call | Diagnosing pause/unpause failures and user-reported errors |
| [Slide deck](slides.md) | Trainers | 12-slide presentation ([Marp](https://marp.app/) Markdown) |

## Quick reference

| | `carbon_credit` | `carbon_marketplace` |
|---|---|---|
| Error while paused | #29 `EmergencyPaused` | #27 `EmergencyPaused` |
| Bad pause window | #28 `InvalidPauseWindow` | #26 `InvalidPauseWindow` |
| Not an admin | #7 `UnauthorizedVerifier` | #7 `UnauthorizedVerifier` |
| Maximum window | 72 h (request ≤ 71 h) | 72 h (request ≤ 71 h) |

## Rendering the slides

```bash
npx @marp-team/marp-cli docs/pause-feature/training/slides.md -o pause-training.pdf
npx @marp-team/marp-cli docs/pause-feature/training/slides.md -o pause-training.pptx
```

## Keeping these accurate

These documents describe contract behaviour in
`contracts/carbon_credit/src/lib.rs` and
`contracts/carbon_marketplace/src/lib.rs`. Update them when any of these change:

- the blocked-function list (calls to `require_not_paused`)
- error codes
- the 72-hour limit
- admin authorization

Related runbooks: [contract-exploit.md](../../runbooks/contract-exploit.md) ·
[key-compromise.md](../../runbooks/key-compromise.md) ·
[contract-upgrade.md](../../runbooks/contract-upgrade.md)
