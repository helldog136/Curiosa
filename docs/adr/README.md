# Architecture decision records

One short file per decision that a reader of the code would otherwise question or undo: why files are split the way they are, which rule must never bend. An ADR records the decision **as the code and the docs show it**; every claim names the file or the document it comes from. If the code changes, the ADR is changed or superseded in the same pull request.

## Format

```
# NNNN. Title (a decision, in the present tense)

Status: Accepted | Superseded by NNNN
Date: YYYY-MM-DD (the day the record was written, not the day of the decision)

## Context      what the situation is and what pushes on it
## Decision     what we do, in plain sentences
## Consequences what becomes easier, what becomes harder, what to check before changing it
## Sources      files and documents the claims come from
```

Rules: one decision per file; numbers are never reused; a changed decision gets a new ADR that supersedes the old one, and the old one is kept with its status updated. Vocabulary is the one of the [glossary](../../GLOSSARY.md).

## Index

| ADR | Decision |
|---|---|
| [0001](0001-menu-files-follow-the-client-server-boundary.md) | The `menu*.ts` files are split along the client/server boundary |
| [0002](0002-dependency-files-stay-split.md) | The five `dependency*.ts` files stay five |
| [0003](0003-skin-security-files-and-allowlist.md) | Skin security: three checkers, one allowlist, no licence check |
| [0004](0004-extras-modules-share-no-helper-file.md) | Modules of curiosa-extras share no helper file |
| [0005](0005-i18n-audit-copy-in-extras.md) | `i18n/audit.mjs` has a verbatim copy on the extras side |
| [0006](0006-permissions-facade.md) | `permissions.ts` stays as the one import path for access checks |
| [0007](0007-ai-access-owner-is-permanent.md) | The owner of an AI access is permanent; orphans are swept |
| [0008](0008-service-caller-identity-is-set-by-the-core.md) | A service method learns who calls it from the core, never from the caller |
