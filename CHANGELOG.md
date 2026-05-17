# Changelog

All notable changes to Skill Audit Loop are recorded here.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This changelog tracks the npm package `@skill-graph/audit`. The `schema_version` the audit loop writes into skill frontmatter is owned by [skill-metadata-protocol](https://github.com/jacob-balslev/skill-metadata-protocol) — currently `6`. See [ADR 0007](https://github.com/jacob-balslev/skill-metadata-protocol/blob/main/docs/adr/0007-version-source-of-truth.md) for the cross-repo source-of-truth model.

## [0.2.0] — 2026-05-17

### Changed

- **Surface collapsed from 13 commands to 4 operations.** `audit`, `improve`, `evaluate`, `evolve`. The previous 13-command surface (separate `lint`, `drift-check`, `graded-audit`, `fix-frontmatter`, etc.) is preserved as internal sub-steps inside these four operations.
- **5-phase audit pipeline preserved inside `audit`.** Deterministic → Graded → Aggregate → Fix → Re-verify still runs end-to-end, but is invisible at the user surface. Authors run `node src/skill-audit.js my-skill` and get the full pipeline.

### Added

- **Health Block recording on every skill.** The seven flat frontmatter fields introduced by Skill Metadata Protocol v6 (`last_audited`, `last_changed`, `audit_verdict`, `eval_score`, `eval_failed_ids`, `lint_verdict`, `drift_status`) are now stamped by the audit operations directly into the skill's frontmatter. State lives on the skill instead of scattered across `eval-history.jsonl`, `routing-misses.jsonl`, `.opencode/progress/skill-audit-*`, `health-ledger.jsonl`, and `findings/*.md`.
- **Karpathy keep-or-revert discipline inside `improve`.** Edit one field, auto-test, automatic revert if the metric drops.
- **Loop-priority worklist via `src/build-skill-audit-worklist.js`.** Uses `last_audited` as the staleness signal to rank skills for the next `evolve` walk.
- **Cross-repo version reconciliation (SH-6124).** `package.json` version bumped 0.1.0 → 0.2.0 to match README and Health Block release. `@skill-graph/protocol` dependency bumped to `^1.3.0` to align with the protocol's v6 contract. Package description updated to reflect the 4-operation surface.

### Removed

- **Scattered log writes (one-corpus-walk migration window).** During v5→v6 migration the audit-loop scripts write to both the flat Health Block fields AND the legacy log files. After one full corpus walk, the log writes are retired and the flat fields are the single source of truth.

## [0.1.0] — 2026-05-13

### Added

- **Initial public release.** Carved out of the `skill-graph` monorepo into a dedicated audit-loop repo (`SKILL_AUDIT_LOOP.md` + `SKILL_AUDIT_CHECKLIST.md` + `src/skill-*.js`).
- **5-phase audit pipeline (Deterministic → Graded → Aggregate → Fix → Re-verify) as the canonical loop shape.**
- **13-command CLI surface** for fine-grained audit operations (collapsed in 0.2.0).
