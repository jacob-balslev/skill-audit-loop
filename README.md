# Skill Audit Loop

> 5-phase audit procedure for keeping `SKILL.md` files grounded against truth sources.

**npm**: `@skill-graph/audit` · **Version**: 0.1.0 · **License**: Apache-2.0

---

## What this repo contains

| Path | Purpose |
|------|---------|
| `SKILL_AUDIT_LOOP.md` | Full audit procedure specification (5 phases) |
| `SKILL_AUDIT_CHECKLIST.md` | Per-skill audit checklist |
| `src/skill-audit.js` | Audit loop orchestrator |
| `src/evaluate-skill.js` | Skill evaluation runner (7-dimension grading) |
| `src/batch-eval.js` | Parallel eval runner for bulk operations |
| `src/eval-linter.js` | Validates eval artifacts |
| `src/eval-staleness-checker.js` | Detects stale evals |
| `src/build-skill-audit-worklist.js` | Ranks and batches skills for audit dispatch |
| `src/skill-test-runner.js` | Run evals against skills |
| `src/skill-evolution-loop.js` | Drives skill evolution/improvement cycle |
| `src/run-skill-improvement-loop.js` | Improvement automation |
| `src/graders/` | Grading prompt modules |
| `evals/` | Evaluation fixtures and baselines |

## The 5 Audit Phases

1. **Deterministic** — schema validation, relation checks, eval coherence, routing quality
2. **Graded** *(optional)* — seven per-dimension prompts dispatched to grader CLI
3. **Aggregate** — combines dimension verdicts → PASS | PASS WITH FIXES | PARTIAL | FAIL
4. **Fix or defer** — apply localized fixes in-pass, otherwise defer with rationale
5. **Re-verify** — re-run lint, regenerate manifest, confirm fixes, update `drift_check.last_verified`

## Quick start

```bash
# Audit a single skill
node src/skill-audit.js --skill path/to/skill-name

# Evaluate a skill (graded mode)
node src/evaluate-skill.js --skill path/to/skill-name --graded

# Build audit worklist for a skill library
node src/build-skill-audit-worklist.js --library path/to/skills/
```

## Related repos

| Repo | Purpose |
|------|---------|
| [skill-metadata-protocol](https://github.com/jacob-balslev/skill-metadata-protocol) | Protocol spec + JSON schemas |
| [skill-graph](https://github.com/jacob-balslev/skill-graph) | Library tooling: lint, router, manifest compiler |
| [skills](https://github.com/jacob-balslev/skills) | Public open-source skill library |

## License

Apache-2.0 — see [LICENSE](LICENSE).
