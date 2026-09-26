# CarbonLedger Accessibility Audit Checklist

**Target:** WCAG 2.1 Level AA

**Scope:** Marketplace, audit explorer, project registration, purchase and retirement flows, dialogs, navigation, data grids, charts, notifications, and responsive layouts.

**Audit status:** Prepared from repository inspection. Manual browser, keyboard, and screen-reader execution remains required before declaring conformance.

## Conformance thresholds

- Normal text: minimum contrast ratio **4.5:1**.
- Large text (at least 18pt, or 14pt bold): minimum contrast ratio **3:1**.
- UI components and focus indicators: verify the applicable WCAG 2.1 AA non-text contrast requirement, including against adjacent colors.
- Information must not depend on color alone.
- All functionality must be available without a mouse and at 200% zoom/reflow.

## 1. Keyboard navigation checklist

Test at desktop and mobile breakpoints with the mouse disconnected or not used. Record the URL, browser, result, and defect ID for every failure.

- [ ] `Tab` moves through every interactive control in a logical order.
- [ ] `Shift+Tab` reverses through the same controls without trapping focus unexpectedly.
- [ ] Every focused control has a visible focus indicator. The global stylesheet defines a `:focus-visible` ring; verify it remains visible on light/dark surfaces.
- [ ] `Enter` activates links, buttons, form submission, sortable headers, grid row activation, and confirmation actions.
- [ ] `Space` activates buttons and selection controls without scrolling unexpectedly.
- [ ] `ArrowUp`/`ArrowDown`, `Home`, and `End` work in the accessible data grid and autocomplete where applicable.
- [ ] `Esc` closes mobile navigation, autocomplete popups, tooltips, and dialogs where expected.
- [ ] Dialog focus moves into the dialog, remains inside while open, and returns to the invoking control after close.
- [ ] No keyboard trap exists in the bulk purchase wizard, wallet prompt, retirement confirmation, certificate view, or filter dialogs.
- [ ] Skip navigation or an equivalent mechanism reaches the main content efficiently.
- [ ] Browser zoom at 200% preserves access to all controls and does not hide content.
- [ ] Reduced-motion preferences do not remove information or make state changes ambiguous.

**Repository evidence:** `KeyboardShortcutsHelp`, `RetireConfirmModal`, `VerifierConfirmDialog`, `SearchAutocomplete`, `AccessibleDataGrid`, and `Navbar` contain explicit keyboard handling. These are implementation indicators, not a substitute for end-to-end manual verification.

## 2. Screen-reader testing checklist

Perform each pass with a clean browser profile and the production-like build. Test Chromium and Firefox where supported.

### NVDA (Windows)

- [ ] Navigate by headings (`H`), landmarks (`D`), buttons (`B`), links (`K`), form fields (`F`), and tables (`T`).
- [ ] Confirm the page title, main landmark, navigation landmark, and current page are announced.
- [ ] Confirm every form field announces an accessible name, role, required state, current value, and validation error.
- [ ] Confirm loading, success, warning, and error updates are announced once through live regions.
- [ ] Confirm dialogs announce their title, modal state, instructions, and available actions.
- [ ] Confirm autocomplete announces the number of results, active option, and selected option.
- [ ] Confirm tables/data grids announce headers, row/column context, sort direction, selection, and pagination.
- [ ] Confirm charts expose a meaningful text alternative or accessible data table.
- [ ] Confirm transaction status and wallet errors are understandable without visual indicators.

### JAWS (Windows)

- [ ] Repeat the NVDA checks with JAWS virtual cursor and forms mode.
- [ ] Confirm virtual cursor and application mode transitions do not prevent keyboard operation.
- [ ] Confirm dialogs, live regions, comboboxes, grids, and validation errors are announced consistently.
- [ ] Confirm no duplicate or misleading accessible names are exposed by icons, SVGs, or visible labels.

**Repository evidence:** The frontend includes `aria-live` status regions, modal `aria-modal`/`aria-labelledby`, combobox/listbox semantics, accessible grid behavior, chart `role="img"` labels, and a screen-reader-only utility. Verify their rendered output with NVDA and JAWS rather than relying on source attributes alone.

## 3. Color and visual presentation checklist

- [ ] Measure normal text against its actual background at **4.5:1 or higher**.
- [ ] Measure large text at **3:1 or higher**.
- [ ] Measure placeholder text, disabled-state text where applicable, helper text, table metadata, badges, and focus indicators.
- [ ] Measure both light and dark themes.
- [ ] Verify verified, pending, suspended, rejected, and completed statuses remain distinguishable by text/icon in addition to color.
- [ ] Verify links are identifiable without color alone, including in dense tables.
- [ ] Verify charts and maps have text/data alternatives and do not rely on color alone.
- [ ] Verify focus indicators contrast against both the control and surrounding surface.
- [ ] Check at 200% zoom and with high-contrast/forced-colors settings where available.

**Finding A11Y-001 (open):** The theme source notes that `--color-neutral-400` (`#9ca3af`) on white is approximately **2.54:1**, below the 4.5:1 normal-text requirement. `--text-tertiary` was changed to `#6d7480` and is documented as approximately 4.71:1, but all direct uses of neutral-400 and dark-theme combinations still need an actual rendered contrast sweep.

**Remediation:** Replace neutral-400 for normal text with a passing token, or restrict it to non-text decoration. Re-run a contrast scanner across representative pages and both themes, then attach results to this report.

## 4. Forms and validation checklist

Review every form in the audited flows, including dynamically rendered and modal forms.

- [ ] Every input, select, textarea, file input, and custom control has a persistent visible `<label>` or an equivalent accessible name.
- [ ] Every visible label is programmatically associated with its control using `htmlFor`/`id` or an equivalent component API.
- [ ] Required fields expose required state and visibly identify the requirement.
- [ ] Instructions and format requirements are associated with `aria-describedby` where needed.
- [ ] Validation errors identify the field, explain how to fix it, and are announced without moving focus unexpectedly.
- [ ] Invalid controls expose `aria-invalid="true"` only while invalid.
- [ ] Submit, cancel, upload, wallet-connect, and retry actions have unique accessible names.
- [ ] File upload progress and failures are announced.
- [ ] Form state survives validation without unexpectedly clearing user input.
- [ ] Autocomplete fields expose combobox state, popup relationship, active descendant, and keyboard selection.
- [ ] Password and secret fields do not expose sensitive values through labels, descriptions, logs, or live regions.

**Repository evidence:** Labels are present in inspected marketplace filters, sort controls, project registration, and provenance filters. Complete this checklist by inspecting every route and searching rendered DOM for unlabeled controls; source-level matches alone do not prove coverage.

## 5. ARIA and component semantics checklist

- [ ] Prefer native HTML semantics before adding ARIA.
- [ ] Every ARIA role is valid for the element and has all required owned states/properties.
- [ ] `aria-label` and `aria-labelledby` names describe the visible control and are not duplicated unnecessarily.
- [ ] `aria-expanded`, `aria-selected`, `aria-checked`, `aria-sort`, `aria-current`, and `aria-busy` reflect actual state.
- [ ] Dialogs use `role="dialog"`, `aria-modal="true"`, and a valid accessible name.
- [ ] Menus, listboxes, comboboxes, tabs, and grids follow their complete keyboard interaction patterns.
- [ ] Live regions use the least assertive setting that communicates the change and do not repeatedly announce unchanged content.
- [ ] Decorative SVGs/icons are hidden from assistive technology; informative graphics have a text alternative.
- [ ] Data visualizations provide an equivalent table or textual summary.
- [ ] Heading levels and landmarks form a logical document structure.
- [ ] `aria-hidden="true"` is never placed on focusable content or an ancestor of required interactive content.
- [ ] Server-rendered and hydrated markup expose the same accessible name and role.

**Repository evidence:** `AccessibleDataGrid`, `SearchAutocomplete`, `KeyboardShortcutsHelp`, chart components, status components, and modal components already implement several of these patterns. Review each implementation against the APG pattern and inspect the browser accessibility tree for state mismatches.

## 6. Automated audit execution record

The frontend has two configured automated accessibility paths:

- Storybook `@storybook/addon-a11y`, including the `color-contrast` check.
- Playwright `@axe-core/playwright` checks tagged for WCAG 2.1 A/AA on `/marketplace` and `/audit`.

Complete and attach the output after running the normal CI-approved commands. This document intentionally does not claim a passing result until the output is recorded.

| Check | Scope | Result | Evidence/issue |
|---|---|---|---|
| axe-core WCAG 2.1 AA | Marketplace | Pending manual/CI run | Attach report |
| axe-core WCAG 2.1 AA | Audit explorer | Pending manual/CI run | Attach report |
| Storybook a11y | All available stories | Pending manual/CI run | Attach report |
| Contrast scan | Light and dark themes | Open: A11Y-001 | Attach measured palette report |

## 7. Findings and remediation register

| ID | Severity | Finding | Remediation | Owner | Status |
|---|---|---|---|---|---|
| A11Y-001 | High | Neutral-400 on white is documented at about 2.54:1 and fails normal-text AA. Direct token usage is not yet fully inventoried. | Replace with a passing text token or limit to decoration; scan both themes and representative routes. | Frontend | Open |
| A11Y-002 | Medium | NVDA and JAWS behavior is not evidenced by a checked-in manual audit record. | Run the screen-reader matrix above and attach recordings/notes for critical flows. | QA/Accessibility | Open |
| A11Y-003 | Medium | Keyboard behavior is covered in component code/tests, but full route-level Tab/Enter/Esc traversal is not evidenced here. | Execute the route matrix, record focus order and dialog restoration, and file defects for failures. | QA/Frontend | Open |
| A11Y-004 | Medium | Automated axe coverage currently names `/marketplace` and `/audit`; other critical flows require explicit coverage or manual review. | Add the purchase, retirement, registration, verifier, and certificate routes to the audit inventory. | QA/Frontend | Open |

## 8. Sign-off criteria

The audit may be marked **Pass** only when:

- [ ] All keyboard checks pass for the critical flows.
- [ ] NVDA and JAWS checks pass, including dialogs, forms, grids, charts, and live updates.
- [ ] Contrast measurements meet the thresholds in both themes, with A11Y-001 closed.
- [ ] All form controls have verified accessible names and usable validation errors.
- [ ] Complex components pass ARIA pattern and accessibility-tree review.
- [ ] Automated axe/Storybook reports are attached and all accepted exceptions have owners and deadlines.
- [ ] Findings are remediated or explicitly accepted by the product owner and accessibility reviewer.

**Audit owner:** ____________________  
**Accessibility reviewer:** ____________________  
**Audit date:** ____________________  
**Release/version:** ____________________  
**Final status:** `Pending` / `Pass` / `Pass with accepted exceptions` / `Fail`
