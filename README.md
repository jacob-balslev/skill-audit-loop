# Skill Audit Loop

> ⚠️ **DEPRECATED — content consolidated into [@skill-graph/cli](https://www.npmjs.com/package/@skill-graph/cli) as of v0.5.6.**
> Install via `npm install -g @skill-graph/cli`. This repo is now a **docs-only mirror** preserved for historical reference and inbound-link stability. See [SH-6132](https://linear.app/sales-hub/issue/SH-6132) for the consolidation rationale.

> One loop, four operations, a flat Health Block on every skill. Karpathy keep-or-revert discipline applied to skill libraries.

**npm**: `@skill-graph/audit` · **Version**: 0.2.0 · **License**: Apache-2.0

---

## The Shape

```
read  →  fix  →  test  →  next
```

Every action falls into one of four operations:

| Operation | What it does | Writes to skill frontmatter |
|---|---|---|
| `audit` | Read every field, check against repo truth | `last_audited`, `audit_verdict`, `lint_verdict`, `drift_status` |
| `improve` | Edit one field, one commit, time-boxed | chosen field + `last_changed` |
| `evaluate` | Run the eval suite (LLM grader) | `eval_score`, `eval_failed_ids`, `freshness` |
| `evolve` | Loop the above over the corpus | all of the above, per skill |

State lives in the skill's own frontmatter — the `audit_state` Health Block introduced in Skill Metadata Protocol v6. No log-file crawl required.

## What this mirror contains

| Path | Purpose |
|------|---------|
| `SKILL_AUDIT_LOOP.md` | Full audit procedure specification (historical reference) |
| `SKILL_AUDIT_CHECKLIST.md` | Per-skill audit checklist (historical reference) |
| `CHANGELOG.md` | Historical version history |

Source files (`src/`, `shared/`, `evals/`, `package.json`) have been consolidated into [`@skill-graph/cli`](https://www.npmjs.com/package/@skill-graph/cli) as of v0.5.6. See the [consolidated source](https://github.com/jacob-balslev/skill-graph) for the live implementation.

## What changed in v0.2.0

- Collapses the previous 13-command surface to 4 operations (`audit`, `improve`, `evaluate`, `evolve`).
- The 5-phase audit pipeline (Deterministic → Graded → Aggregate → Fix → Re-verify) now lives entirely inside the `audit` operation — invisible at the user surface, intact behind it.
- Karpathy keep-or-revert is enforced inside `improve`: edit one field, auto-test, automatic revert if the metric drops.
- Adds the Health Block (`last_audited`, `last_changed`, `audit_verdict`, `eval_score`, `eval_failed_ids`, `lint_verdict`, `drift_status`) to every skill — state lives on the skill instead of in scattered log files.

## Quick start (consolidated into @skill-graph/cli)

```bash
# Install the consolidated package
npm install -g @skill-graph/cli

# Audit a single skill
skill-graph audit my-skill

# Audit with graded dimensions (seven LLM-graded scores)
skill-graph audit my-skill --graded

# Evaluate a skill
skill-graph evaluate my-skill

# Show the Health Block at a glance
skill-graph status my-skill
```

For the full command reference, see [@skill-graph/cli on npm](https://www.npmjs.com/package/@skill-graph/cli) or the [skill-graph repository](https://github.com/jacob-balslev/skill-graph).

## Related repos

| Repo | Purpose |
|------|---------|
| [skill-metadata-protocol](https://github.com/jacob-balslev/skill-metadata-protocol) | Protocol spec + JSON schemas (the Health Block lives here) |
| [skill-graph](https://github.com/jacob-balslev/skill-graph) | Library tooling: lint, router, manifest compiler |
| [skills](https://github.com/jacob-balslev/skills) | Public open-source skill library |

## License

Apache-2.0 — see [LICENSE](LICENSE).
