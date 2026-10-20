# Folder Structure

This document describes the layout of the repository and clarifies which
frontend application is the live one.

## Live frontend

- `frontend/` — **the only live frontend application.** All UI work,
  components, and imports belong here.

## Removed legacy copies

The following directories were duplicated legacy frontend copies and have been
removed (archived on the `archive/legacy-frontend` branch):

- `carbonledger/frontend/` — unused duplicate of `frontend/`
- `src/` (root-level) — unused legacy source tree
- `components/` (root-level) — unused legacy components

Do not add code to these paths; they no longer exist on `main`.

## Repository layout

```
.
├── frontend/            # Live frontend application
│   └── src/
│       ├── components/
│       └── lib/
├── carbonledger/        # Backend / contracts (no frontend)
├── folder-structure.md  # This file
└── ...
```

## CI

CI workflows build and test only `frontend/`. Any workflow path referencing
`carbonledger/frontend/`, root `src/`, or root `components/` should be updated
to point at `frontend/`.
