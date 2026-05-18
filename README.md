# Skill Audit Loop

[![DEPRECATED](https://img.shields.io/badge/status-deprecated%20%C2%B7%20docs--only%20mirror-9ca3af?style=flat-square)](https://github.com/jacob-balslev/skill-graph/blob/main/docs/adr/0009-sibling-repo-deprecation.md) [![Canonical home](https://img.shields.io/badge/canonical%20home-%40skill--graph%2Fcli-cb3837?style=flat-square&logo=npm)](https://www.npmjs.com/package/@skill-graph/cli) [![License Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-green?style=flat-square)](LICENSE)

> ⚠️ **This repository is deprecated as of 2026-05-18.**
>
> The Skill Audit Loop — `audit`, `improve`, `evaluate`, `evolve` operations plus all source code, graders, eval fixtures, and shared utilities — has been consolidated into [`@skill-graph/cli`](https://www.npmjs.com/package/@skill-graph/cli) (v0.5.6 onward). This repository is preserved as a **docs-only mirror** for historical reference and inbound-link stability. It is not archived — links into the README, `SKILL_AUDIT_LOOP.md`, and `SKILL_AUDIT_CHECKLIST.md` here continue to resolve, but source files (`src/`, `evals/`, `shared/`, `package.json`) have moved.
>
> See [ADR 0009 — Sibling Repo Deprecation](https://github.com/jacob-balslev/skill-graph/blob/main/docs/adr/0009-sibling-repo-deprecation.md) for the consolidation rationale, and [SH-6132](https://linear.app/sales-hub/issue/SH-6132) for the original decision.

## The shape (preserved here for reference)

```
read  →  fix  →  test  →  next
```

| Operation | What it does | Writes to skill frontmatter |
|---|---|---|
| `audit` | Read every field, check against repo truth | `last_audited`, `audit_verdict`, `lint_verdict`, `drift_status` |
| `improve` | Edit one field, one commit, time-boxed | chosen field + `last_changed` |
| `evaluate` | Run the eval suite (LLM grader) | `eval_score`, `eval_failed_ids`, `freshness` |
| `evolve` | Loop the above over the corpus | all of the above, per skill |

State lives in the skill's own frontmatter — the `audit_state` Health Block introduced in Skill Metadata Protocol v6. No log-file crawl required.

## Quick start (consolidated CLI)

```bash
# Install the consolidated package
npm install -g @skill-graph/cli

# Audit a single skill
skill-graph audit my-skill

# Audit with graded dimensions (seven LLM-graded scores)
skill-graph audit my-skill --graded

# Improve one field — auto-tests and keeps or reverts based on eval_score delta
skill-graph improve my-skill --field mental_model

# Evaluate a skill
skill-graph evaluate my-skill

# Evolve the corpus — audit + improve + evaluate, prioritised by staleness
skill-graph evolve --top 10

# Show the Health Block at a glance
skill-graph status my-skill
```

For the full command reference, see [`@skill-graph/cli` on npm](https://www.npmjs.com/package/@skill-graph/cli) or [`jacob-balslev/skill-graph`](https://github.com/jacob-balslev/skill-graph).

## Where to find the canonical content

| You're looking for… | Canonical home |
|---|---|
| Install the audit CLI | `npm install -g @skill-graph/cli` → [npm](https://www.npmjs.com/package/@skill-graph/cli) |
| The full audit procedure spec | [`docs/SKILL_AUDIT_LOOP.md`](https://github.com/jacob-balslev/skill-graph/blob/main/docs/SKILL_AUDIT_LOOP.md) in `skill-graph` |
| The per-skill audit checklist | [`docs/SKILL_AUDIT_CHECKLIST.md`](https://github.com/jacob-balslev/skill-graph/blob/main/docs/SKILL_AUDIT_CHECKLIST.md) in `skill-graph` |
| Audit source code | [`scripts/`](https://github.com/jacob-balslev/skill-graph/tree/main/scripts) in `skill-graph` |
| The Health Block field definitions | [`docs/SKILL_METADATA_PROTOCOL.md`](https://github.com/jacob-balslev/skill-graph/blob/main/docs/SKILL_METADATA_PROTOCOL.md) in `skill-graph` |
| Eval fixtures and baselines | [`evals/`](https://github.com/jacob-balslev/skill-graph/tree/main/evals) in `skill-graph` |
| Architecture Decision Records | [`docs/adr/`](https://github.com/jacob-balslev/skill-graph/tree/main/docs/adr) in `skill-graph` |

## What's still here

The two procedure documents below remain as historical snapshots. The authoritative versions are in [`skill-graph`](https://github.com/jacob-balslev/skill-graph) — links above. Treat the copies here as frozen at the deprecation point (2026-05-18, commit [`9ceea1f`](https://github.com/jacob-balslev/skill-audit-loop/commit/9ceea1f)) and not subject to further updates.

| File | Status |
|---|---|
| [`SKILL_AUDIT_LOOP.md`](SKILL_AUDIT_LOOP.md) | Historical snapshot of the audit procedure. **Canonical:** [`skill-graph/docs/SKILL_AUDIT_LOOP.md`](https://github.com/jacob-balslev/skill-graph/blob/main/docs/SKILL_AUDIT_LOOP.md). |
| [`SKILL_AUDIT_CHECKLIST.md`](SKILL_AUDIT_CHECKLIST.md) | Historical snapshot of the per-skill checklist. **Canonical:** [`skill-graph/docs/SKILL_AUDIT_CHECKLIST.md`](https://github.com/jacob-balslev/skill-graph/blob/main/docs/SKILL_AUDIT_CHECKLIST.md). |
| [`CHANGELOG.md`](CHANGELOG.md) | Historical npm version history for `@skill-graph/audit` 0.1.0 → 0.3.0. Subsequent releases ship as `@skill-graph/cli`. |

## The Skill Graph ecosystem

<p align="center">
  <img src="https://raw.githubusercontent.com/jacob-balslev/skill-graph/main/docs/images/skill-graph-ecosystem.svg" alt="Skill Graph ecosystem — skill-graph is the canonical monolith; skill-metadata-protocol and skill-audit-loop are docs-only mirrors." width="640">
</p>

| Repo | Status | Purpose |
|---|---|---|
| [skill-graph](https://github.com/jacob-balslev/skill-graph) | **active** | Canonical home — protocol spec, schemas, CLI, lint, manifest, router, drift, audit loop, export |
| [skills](https://github.com/jacob-balslev/skills) | **active** | Public open-source skill library |
| [skill-metadata-protocol](https://github.com/jacob-balslev/skill-metadata-protocol) | mirror | Historical docs-only mirror of the normative spec |
| **skill-audit-loop** *(this repo)* | mirror | Historical docs-only mirror of the audit procedure |

## Contributing & Trust

This repo is read-only. To contribute to the active project:

- **Issues, PRs, discussions** → file against [`jacob-balslev/skill-graph`](https://github.com/jacob-balslev/skill-graph/issues).
- **Security** — report vulnerabilities privately via the [security policy](SECURITY.md), not as public issues.
- **Code of Conduct** — this project follows the [Contributor Covenant 2.1](CODE_OF_CONDUCT.md).
- **License** — [Apache-2.0](LICENSE).
