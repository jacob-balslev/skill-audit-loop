# Skill Audit Loop

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

## What this repo contains

| Path | Purpose |
|------|---------|
| `SKILL_AUDIT_LOOP.md` | Full audit procedure specification |
| `SKILL_AUDIT_CHECKLIST.md` | Per-skill audit checklist used during `audit` |
| `src/skill-audit.js` | The `audit` operation (deterministic + optional graded mode) |
| `src/skill-improve.js` | The `improve` operation (one field, keep-or-revert) |
| `src/evaluate-skill.js` | The `evaluate` operation (eval suite runner) |
| `src/skill-evolve.js` | The `evolve` operation (corpus walker) |
| `src/skill-status.js` | Read-only view of a skill's Health Block |
| `src/build-skill-audit-worklist.js` | Ranks skills for evolve dispatch |
| `src/batch-eval.js` | Parallel eval runner for bulk operations |
| `src/eval-linter.js` | Validates eval artifacts |
| `src/eval-staleness-checker.js` | Detects stale evals |
| `src/graders/` | Graded-dimension prompt modules |
| `src/skill-improvement-helpers.js` | Shared evaluator logic — candidate gating, model executor resolution, JSON extraction, history persistence |
| `src/research-feedback.js` | Research-artifact analysis: fingerprint scoring, audit aggregation, per-skill brief enrichment |
| `shared/model-provider.js` | Model alias → backend resolution (claude/codex/opencode/gemini), `MODEL_REGISTRY` |
| `shared/skill-frontmatter.js` | Minimal YAML frontmatter parser for SKILL.md files |
| `evals/` | Evaluation fixtures and baselines |

## What changed in v0.2.0

- Collapses the previous 13-command surface to 4 operations (`audit`, `improve`, `evaluate`, `evolve`).
- The 5-phase audit pipeline (Deterministic → Graded → Aggregate → Fix → Re-verify) now lives entirely inside the `audit` operation — invisible at the user surface, intact behind it.
- Karpathy keep-or-revert is enforced inside `improve`: edit one field, auto-test, automatic revert if the metric drops.
- Adds the Health Block (`last_audited`, `last_changed`, `audit_verdict`, `eval_score`, `eval_failed_ids`, `lint_verdict`, `drift_status`) to every skill — state lives on the skill instead of in scattered log files.

## Quick start

```bash
# Audit a single skill
node src/skill-audit.js my-skill

# Audit with graded dimensions (seven LLM-graded scores)
node src/skill-audit.js my-skill --graded

# Improve one field — auto-tests and keeps or reverts based on eval_score delta
node src/skill-improve.js my-skill --field mental_model

# Evaluate a skill
node src/evaluate-skill.js my-skill

# Evolve the corpus — audit + improve + evaluate, prioritised by staleness
node src/skill-evolve.js --top 10

# Show the Health Block at a glance
node src/skill-status.js my-skill
```

## Related repos

| Repo | Purpose |
|------|---------|
| [skill-metadata-protocol](https://github.com/jacob-balslev/skill-metadata-protocol) | Protocol spec + JSON schemas (the Health Block lives here) |
| [skill-graph](https://github.com/jacob-balslev/skill-graph) | Library tooling: lint, router, manifest compiler |
| [skills](https://github.com/jacob-balslev/skills) | Public open-source skill library |

## License

Apache-2.0 — see [LICENSE](LICENSE).
