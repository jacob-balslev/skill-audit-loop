#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { parseArgs } = require('../shared/parse-args');
const { buildRankedReport } = require('./skill-leverage-ranker');

const REPO_ROOT = path.resolve(__dirname, '../..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'skills.manifest.json');
const PROGRESS_DIR = path.join(REPO_ROOT, '.opencode', 'progress');
const DEFAULT_JSON_OUT = path.join(PROGRESS_DIR, 'skill-audit-worklist.json');
const DEFAULT_MD_OUT = path.join(PROGRESS_DIR, 'skill-audit-worklist.md');
const AUDIT_ARTIFACT_DIR = path.join(PROGRESS_DIR, 'skill-audits');
const AUDIT_STATE_PATH = path.join(PROGRESS_DIR, 'skill-audit-state.json');
const TRACKER_PATH = path.join(PROGRESS_DIR, 'skill-audit-tracker.json');

// schema_version 2.0.0 additions (build-worklist 0.3.0):
// Joins skill-graph/data/publication-classification.json into a parallel
// publicationQueue array + emits a publication-focused MD view.
const SCHEMA_VERSION = '2.0.0';
const PUBLICATION_LEDGER_PATH = path.join(REPO_ROOT, 'skill-graph', 'data', 'publication-classification.json');
const PUBLISHED_SET_DIR = path.join(REPO_ROOT, 'skill-graph', 'marketplace', 'skills');
const DEFAULT_PUBLICATION_MD_OUT = path.join(REPO_ROOT, 'skill-graph', 'docs', 'marketplace-publication-queue.generated.md');
const PACKAGE_JSON_PATH = path.join(__dirname, '..', 'package.json');
const TIER_ORDER = { S: 0, A: 1, B: 2, C: 3 };
const SUPERSEDES = [
  'skill-graph/docs/_archived/marketplace-publication-priority-2026-05-18.md',
];
const CHANGELOG_SUMMARY = '2.0.0: add publicationQueue + ledger join; rename generatedAt → generated_at (alias kept).';

const CATEGORY_WEIGHTS = {
  'Product Domain': 18,
  'Agent System': 16,
  'Design & UX': 14,
  'Technical Capability': 12,
  'Meta Method': 10,
  'Quality & Process': 8,
};

const ROUTING_WEIGHTS = {
  primary: 10,
  router: 8,
  gate: 7,
  verifier: 6,
  overlay: 3,
  universal: 8,
};

const TYPE_WEIGHTS = {
  workflow: 4,
  hybrid: 4,
  capability: 3,
  framework: 2,
  doctrine: 2,
  domain: 3,
  strategy: 2,
  overlay: 1,
  skill: 1,
};

const REPO_SCOPE_WEIGHTS = {
  salesHub: 6,
  shared: 4,
};

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function loadManifest(manifestPath = MANIFEST_PATH) {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function loadSkills(manifest) {
  return [...(manifest.skills?.shared || []), ...(manifest.skills?.salesHub || [])];
}

function slugifySkillName(name) {
  return String(name).replace(/[\/]+/g, '--').replace(/[^a-zA-Z0-9_.-]+/g, '-');
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function fileTimestamp(filePath) {
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch {
    return null;
  }
}

function unquoteScalar(value) {
  return String(value || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .trim();
}

function frontmatterScalar(content, field) {
  const match = content.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
  return match ? unquoteScalar(match[1]) : null;
}

function readSkillFileState(skill) {
  const skillPath = path.resolve(REPO_ROOT, skill.path);
  if (!fs.existsSync(skillPath)) {
    return {
      skillVersion: null,
      skillLastUpdated: null,
      skillLastUpdatedSource: null,
    };
  }

  const content = fs.readFileSync(skillPath, 'utf8');
  const skillVersion = frontmatterScalar(content, 'version');
  const freshness = frontmatterScalar(content, 'freshness');
  const lastAudited = frontmatterScalar(content, 'last_audited');
  const driftCheck = frontmatterScalar(content, 'drift_check');
  const modifiedAt = fileTimestamp(skillPath);
  const datedField = lastAudited || freshness || driftCheck;

  return {
    skillVersion,
    skillLastUpdated: datedField || modifiedAt,
    skillLastUpdatedSource: datedField
      ? `frontmatter:${lastAudited ? 'last_audited' : freshness ? 'freshness' : 'drift_check'}`
      : path.relative(REPO_ROOT, skillPath),
  };
}

function loadQueueState(options = {}) {
  const progressDir = options.progressDir ? path.resolve(options.progressDir) : PROGRESS_DIR;
  const auditDir = options.auditDir ? path.resolve(options.auditDir) : path.join(progressDir, 'skill-audits');
  const auditStatePath = options.auditStatePath ? path.resolve(options.auditStatePath) : path.join(progressDir, 'skill-audit-state.json');
  const trackerPath = options.trackerPath ? path.resolve(options.trackerPath) : path.join(progressDir, 'skill-audit-tracker.json');
  const previousWorklistPath = options.previousWorklistPath ? path.resolve(options.previousWorklistPath) : path.join(progressDir, 'skill-audit-worklist.json');

  const state = {
    completedByName: new Map(),
    completedBySlug: new Map(),
    claimedByName: new Map(),
    priorStatusByName: new Map(),
  };

  if (fs.existsSync(auditDir)) {
    for (const file of fs.readdirSync(auditDir)) {
      if (!file.endsWith('.scorecard.md')) continue;
      const slug = file.replace(/\.scorecard\.md$/, '');
      const absPath = path.join(auditDir, file);
      state.completedBySlug.set(slug, {
        source: path.relative(REPO_ROOT, absPath),
        completedAt: fileTimestamp(absPath),
      });
    }
  }

  const auditState = readJsonIfExists(auditStatePath);
  if (auditState?.last_completed) {
    state.completedByName.set(auditState.last_completed, {
      source: path.relative(REPO_ROOT, auditStatePath),
      completedAt: auditState.last_updated || null,
    });
  }
  if (auditState?.current_item && auditState.current_phase && auditState.current_phase !== 'done') {
    state.claimedByName.set(auditState.current_item, {
      source: path.relative(REPO_ROOT, auditStatePath),
      phase: auditState.current_phase,
      claimedAt: auditState.last_updated || null,
    });
  }

  const tracker = readJsonIfExists(trackerPath);
  for (const batch of Object.values(tracker?.batches || {})) {
    for (const entry of batch.skills || []) {
      if (!entry?.skill || !entry?.status) continue;
      if (entry.status === 'completed') {
        state.completedByName.set(entry.skill, {
          source: path.relative(REPO_ROOT, trackerPath),
          completedAt: entry.completedAt || null,
        });
      } else if (entry.status === 'claimed') {
        state.claimedByName.set(entry.skill, {
          source: path.relative(REPO_ROOT, trackerPath),
          phase: 'claimed',
          claimedAt: entry.claimedAt || entry.updatedAt || null,
        });
      }
    }
  }

  const previousWorklist = readJsonIfExists(previousWorklistPath);
  for (const entry of previousWorklist?.worklist || []) {
    if (!entry?.skill || !entry?.status || entry.status === 'pending') continue;
    state.priorStatusByName.set(entry.skill, {
      status: entry.status,
      source: path.relative(REPO_ROOT, previousWorklistPath),
      completedAt: entry.completedAt || null,
      claimedAt: entry.claimedAt || null,
    });
  }

  return state;
}

function queueStateForSkill(skill, queueState) {
  const slug = slugifySkillName(skill.name);
  const completed = queueState.completedByName.get(skill.name) || queueState.completedBySlug.get(slug);
  if (completed) {
    return {
      status: 'completed',
      statusEvidence: completed,
    };
  }

  const claimed = queueState.claimedByName.get(skill.name);
  if (claimed) {
    return {
      status: 'claimed',
      statusEvidence: claimed,
    };
  }

  const prior = queueState.priorStatusByName.get(skill.name);
  if (prior?.status === 'completed' || prior?.status === 'claimed') {
    return {
      status: prior.status,
      statusEvidence: prior,
    };
  }

  return {
    status: 'pending',
    statusEvidence: null,
  };
}

function checklistStateForSkill(skill, queueState) {
  const queue = queueStateForSkill(skill, queueState);
  const skillFileState = readSkillFileState(skill);
  const completedAt = queue.status === 'completed'
    ? queue.statusEvidence?.completedAt || null
    : null;
  const claimedAt = queue.status === 'claimed'
    ? queue.statusEvidence?.claimedAt || null
    : null;
  const statusUpdatedAt = completedAt || claimedAt || null;

  return {
    ...queue,
    skillVersion: skillFileState.skillVersion,
    upgraded: queue.status === 'completed',
    upgradedVersion: queue.status === 'completed' ? skillFileState.skillVersion : null,
    claimed: queue.status === 'claimed',
    claimedAt,
    completedAt,
    lastUpdated: statusUpdatedAt || skillFileState.skillLastUpdated,
    lastUpdatedSource: statusUpdatedAt
      ? queue.statusEvidence?.source || null
      : skillFileState.skillLastUpdatedSource,
  };
}

function renderCell(value) {
  if (value === null || value === undefined || value === '') return '';
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function titleize(name) {
  return String(name)
    .replace(/sales-hub$/i, '')
    .replace(/[\/]+/g, ' ')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function inferProjectRelevance(skill) {
  const projects = new Set();

  if (skill.repoScope === 'salesHub' || skill.primaryCategory === 'Product Domain') {
    projects.add('sales-hub');
  }

  if (skill.primaryCategory === 'Agent System' || skill.family === 'agent-ops' || skill.family === 'skill-system') {
    projects.add('development-root');
    projects.add('agent-orchestration');
  }

  if (skill.primaryCategory === 'Design & UX') {
    projects.add('sales-hub');
    projects.add('orchestrator-ui');
  }

  if (skill.primaryCategory === 'Technical Capability') {
    projects.add('development-root');
    projects.add('sales-hub');
  }

  if (projects.size === 0) {
    projects.add('development-root');
  }

  return [...projects];
}

function inferQueueGroup(skill) {
  if (skill.primaryCategory === 'Product Domain') return 'product-domain';
  if (skill.primaryCategory === 'Agent System') return 'agent-system';
  if (skill.primaryCategory === 'Design & UX') return 'design-and-ux';
  if (skill.primaryCategory === 'Technical Capability') return 'technical-capability';
  return 'meta-method';
}

function buildResearchQueries(skill) {
  const subject = titleize(skill.name);
  const queries = [
    `What is ${subject}?`,
    `${subject} latest documentation`,
    `${subject} best practices`,
  ];

  if (/shopify|printify|printful|gelato|gooten|stripe|paypal|meta|google ads|tiktok|bigcommerce|woocommerce|faire|lemonsqueezy|ankorstore|dhl|usps|shipbob|shipmonk|wix|squarespace/i.test(subject)) {
    queries.push(`${subject} API documentation`);
    queries.push(`${subject} webhooks authentication`);
  }

  return [...new Set(queries)];
}

function buildArtifacts(skill) {
  const slug = slugifySkillName(skill.name);
  return {
    findings: `.opencode/progress/skill-audits/${slug}.md`,
    scorecard: `.opencode/progress/skill-audits/${slug}.scorecard.md`,
    repoResearch: `.opencode/progress/skill-audits/${slug}.research.md`,
    sourceTruthCatalog: `.opencode/progress/skill-audits/${slug}.catalog.json`,
  };
}

function buildRepoResearch(skill) {
  const artifacts = buildArtifacts(skill);
  return {
    catalogCommand: `node scripts/skill/source-truth-catalog.js --skill ${skill.name} --out ${artifacts.sourceTruthCatalog}`,
    readFirst: [skill.path, 'docs/guides/agent-skill-audit-guide-and-template.md'],
  };
}

function importanceBandFromRank(index, total) {
  const percentile = (index + 1) / total;
  if (percentile <= 0.15) return 'critical';
  if (percentile <= 0.4) return 'high';
  if (percentile <= 0.75) return 'medium';
  return 'low';
}

function summarizeReasons(skill, leverage) {
  const reasons = [];
  reasons.push(`${skill.primaryCategory} / ${skill.routingRole}`);
  if (leverage?.score) {
    reasons.push(`telemetry ${leverage.score}`);
  }
  if (skill.graph?.degree) {
    reasons.push(`graph degree ${skill.graph.degree}`);
  }
  if (skill.repoScope === 'salesHub') {
    reasons.push('repo-local Sales Hub authority');
  }
  return reasons;
}

function scoreSkill(skill, leverage) {
  const category = CATEGORY_WEIGHTS[skill.primaryCategory] || 12;
  const routing = ROUTING_WEIGHTS[skill.routingRole] || 4;
  const type = TYPE_WEIGHTS[skill.type] || 2;
  const repoScope = REPO_SCOPE_WEIGHTS[skill.repoScope] || 4;
  const refs = skill.hasRefs ? 2 : 0;
  const graph = Math.min(Math.round((skill.graph?.degree || 0) / 2), 8);
  const leverageScore = Math.min(Math.round((leverage?.score || 0) / 20), 10);

  return {
    total: category + routing + type + repoScope + refs + graph + leverageScore,
    components: {
      category,
      routing,
      type,
      repoScope,
      refs,
      graph,
      leverage: leverageScore,
    },
  };
}

function loadGeneratorVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
    return pkg.version || null;
  } catch {
    return null;
  }
}

function loadPublicationLedger(options = {}) {
  const ledgerPath = options.publicationLedgerPath
    ? path.resolve(options.publicationLedgerPath)
    : PUBLICATION_LEDGER_PATH;
  if (!fs.existsSync(ledgerPath)) {
    return { ledgerPath: null, skills: {}, raw: null };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    return { ledgerPath, skills: raw.skills || {}, raw };
  } catch {
    return { ledgerPath, skills: {}, raw: null };
  }
}

function loadPublishedSet(options = {}) {
  const dir = options.publishedSetDir ? path.resolve(options.publishedSetDir) : PUBLISHED_SET_DIR;
  if (!fs.existsSync(dir)) return new Set();
  try {
    return new Set(
      fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
        .map((e) => e.name),
    );
  } catch {
    return new Set();
  }
}

function buildPublicationQueue(ledger, publishedSet, worklistEntries) {
  const rankByName = new Map(worklistEntries.map((e) => [e.skill, e.rank]));
  const repoScopeByName = new Map(worklistEntries.map((e) => [e.skill, e.repoScope]));
  const conflicts = [];

  // publicationQueue entries are publishable rows with a non-null tier; sorted Tier S→C then pop_score desc.
  const queue = Object.entries(ledger.skills)
    .filter(([, entry]) => entry.classification === 'publishable' && entry.tier)
    .map(([skill, entry]) => ({
      skill,
      tier: entry.tier,
      pop_score: entry.pop_score,
      source: entry.source || null,
      needs_sanitization: entry.needs_sanitization || null,
      demand_signal: entry.demand_signal || null,
      rename_to: entry.rename_to || null,
      classification: entry.classification,
      included_in_export: publishedSet.has(skill),
      worklist_rank: rankByName.get(skill) || null,
      notes: entry.notes || null,
    }))
    .sort((a, b) => {
      const t = (TIER_ORDER[a.tier] ?? 9) - (TIER_ORDER[b.tier] ?? 9);
      if (t !== 0) return t;
      if (a.pop_score !== b.pop_score) return (b.pop_score || 0) - (a.pop_score || 0);
      return a.skill.localeCompare(b.skill);
    })
    .map((entry, index) => ({ rank: index + 1, ...entry }));

  // Conflict detection: ledger says publishable but manifest scope says salesHub (heuristic — warn only).
  for (const [skill, entry] of Object.entries(ledger.skills)) {
    const manifestScope = repoScopeByName.get(skill);
    if (!manifestScope) continue;
    if (entry.classification === 'publishable' && manifestScope === 'salesHub') {
      conflicts.push({
        skill,
        ledger_classification: entry.classification,
        manifest_repo_scope: manifestScope,
        reason: 'ledger marks publishable but skill is in sales-hub manifest scope; verify body is portable before publishing',
      });
    }
    if (entry.classification === 'sales-hub-bound' && manifestScope === 'shared') {
      conflicts.push({
        skill,
        ledger_classification: entry.classification,
        manifest_repo_scope: manifestScope,
        reason: 'ledger marks sales-hub-bound but skill is in shared scope; verify ledger reflects current truth',
      });
    }
  }

  // Validation: ledger entries that point at non-existent skills (warn only).
  const manifestSet = new Set(worklistEntries.map((e) => e.skill));
  const orphans = Object.keys(ledger.skills).filter((s) => !manifestSet.has(s) && !publishedSet.has(s));

  // Aggregates
  const tierCounts = { S: 0, A: 0, B: 0, C: 0 };
  const classCounts = { publishable: 0, 'sales-hub-bound': 0, 'personal-infra': 0 };
  for (const entry of Object.values(ledger.skills)) {
    if (entry.tier && tierCounts[entry.tier] !== undefined) tierCounts[entry.tier]++;
    classCounts[entry.classification] = (classCounts[entry.classification] || 0) + 1;
  }

  return {
    publicationQueue: queue,
    conflicts,
    orphans,
    publicationSummary: {
      publishable: classCounts.publishable,
      salesHubBound: classCounts['sales-hub-bound'],
      personalInfra: classCounts['personal-infra'],
      alreadyPublished: publishedSet.size,
      tiers: tierCounts,
      ledgerEntries: Object.keys(ledger.skills).length,
    },
  };
}

function buildWorklist(manifest, options = {}) {
  const skills = loadSkills(manifest);
  const leverageReport = buildRankedReport({ skills, limit: skills.length });
  const leverageBySkill = new Map(leverageReport.top_skills.map((entry) => [entry.skill, entry]));
  const queueState = loadQueueState(options);

  const ranked = skills
    .map((skill) => {
      const leverage = leverageBySkill.get(skill.name) || null;
      const score = scoreSkill(skill, leverage);
      const checklist = checklistStateForSkill(skill, queueState);
      return {
        skill: skill.name,
        path: skill.path,
        repoScope: skill.repoScope,
        primaryCategory: skill.primaryCategory,
        layerPrimary: skill.layerPrimary,
        routingRole: skill.routingRole,
        type: skill.type,
        family: skill.family,
        importanceScore: score.total,
        importanceBand: 'unassigned',
        scoreComponents: score.components,
        leverage: leverage ? {
          score: leverage.score,
          reasons: leverage.reasons,
          signals: leverage.signals,
        } : null,
        projectRelevance: inferProjectRelevance(skill),
        queueGroup: inferQueueGroup(skill),
        reasons: summarizeReasons(skill, leverage),
        research: {
          repo: buildRepoResearch(skill),
          web: buildResearchQueries(skill),
        },
        artifacts: buildArtifacts(skill),
        executionContract: [
          'Research the skill against live repo truth first',
          'Research the external domain or vendor docs second',
          'Update SKILL.md and evals in the same pass',
          'Fix confirmed repo/codebase drift that the audit uncovers',
        ],
        status: checklist.status,
        statusEvidence: checklist.statusEvidence,
        upgraded: checklist.upgraded,
        upgradedVersion: checklist.upgradedVersion,
        skillVersion: checklist.skillVersion,
        claimed: checklist.claimed,
        claimedAt: checklist.claimedAt,
        completedAt: checklist.completedAt,
        lastUpdated: checklist.lastUpdated,
        lastUpdatedSource: checklist.lastUpdatedSource,
      };
    })
    .sort((a, b) => b.importanceScore - a.importanceScore || a.skill.localeCompare(b.skill))
    .map((entry, index, all) => ({
      rank: index + 1,
      ...entry,
      importanceBand: importanceBandFromRank(index, all.length),
    }));

  const countsByBand = ranked.reduce((acc, entry) => {
    acc[entry.importanceBand] = (acc[entry.importanceBand] || 0) + 1;
    return acc;
  }, {});
  const pendingCountsByBand = ranked
    .filter((entry) => entry.status !== 'completed')
    .reduce((acc, entry) => {
      acc[entry.importanceBand] = (acc[entry.importanceBand] || 0) + 1;
      return acc;
    }, {});
  const countsByStatus = ranked.reduce((acc, entry) => {
    acc[entry.status] = (acc[entry.status] || 0) + 1;
    return acc;
  }, {});

  const generatedAt = new Date().toISOString();
  const generatorVersion = loadGeneratorVersion();
  const skipPublication = Boolean(options['skip-publication'] || options.skipPublication);

  const baseSummary = {
    activeSkills: manifest.summary?.active || ranked.length,
    salesHubSkills: manifest.summary?.salesHub || 0,
    sharedSkills: manifest.summary?.shared || 0,
    bands: countsByBand,
    pendingBands: pendingCountsByBand,
    status: countsByStatus,
  };

  let publicationBlock = { publicationQueue: [], conflicts: [], orphans: [], publicationSummary: null };
  let ledgerPath = null;
  if (!skipPublication) {
    const ledger = loadPublicationLedger(options);
    ledgerPath = ledger.ledgerPath;
    const publishedSet = loadPublishedSet(options);
    publicationBlock = buildPublicationQueue(ledger, publishedSet, ranked);
  }

  return {
    schema_version: SCHEMA_VERSION,
    generator_version: generatorVersion,
    generated_at: generatedAt,
    generatedAt, // deprecated alias — remove in 0.4.0
    supersedes: skipPublication ? [] : SUPERSEDES,
    changelog_summary: CHANGELOG_SUMMARY,
    source: 'skill-audit-loop/src/build-skill-audit-worklist.js',
    entrypoint: 'scripts/skill/build-skill-audit-worklist.js',
    publication_ledger: ledgerPath ? path.relative(REPO_ROOT, ledgerPath) : null,
    summary: {
      ...baseSummary,
      publication: publicationBlock.publicationSummary,
    },
    rankingMethod: {
      categoryWeights: CATEGORY_WEIGHTS,
      routingWeights: ROUTING_WEIGHTS,
      typeWeights: TYPE_WEIGHTS,
      repoScopeWeights: REPO_SCOPE_WEIGHTS,
      leverageSource: 'scripts/skill/skill-leverage-ranker.js',
    },
    worklist: ranked,
    publicationQueue: publicationBlock.publicationQueue,
    conflicts: publicationBlock.conflicts,
    publication_orphans: publicationBlock.orphans,
  };
}

function renderMarkdown(worklist) {
  const lines = [];
  lines.push('# Skill Audit Worklist');
  lines.push('');
  lines.push(`Generated: ${worklist.generatedAt}`);
  lines.push('');
  lines.push('This worklist ranks every active skill for one-by-one audit work. Each skill entry is intentionally scoped to: repo research, external/domain research, skill+eval updates, and confirmed codebase fixes.');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Active skills: ${worklist.summary.activeSkills}`);
  lines.push(`- Shared skills: ${worklist.summary.sharedSkills}`);
  lines.push(`- Sales Hub skills: ${worklist.summary.salesHubSkills}`);
  lines.push(`- Critical band: ${worklist.summary.bands.critical || 0}`);
  lines.push(`- High band: ${worklist.summary.bands.high || 0}`);
  lines.push(`- Medium band: ${worklist.summary.bands.medium || 0}`);
  lines.push(`- Low band: ${worklist.summary.bands.low || 0}`);
  lines.push(`- Pending: ${worklist.summary.status.pending || 0}`);
  lines.push(`- Claimed: ${worklist.summary.status.claimed || 0}`);
  lines.push(`- Upgraded: ${worklist.summary.status.completed || 0}`);
  lines.push('');
  lines.push('## Ranking Method');
  lines.push('');
  lines.push('- Importance = category weight + routing role + type + repo scope + references + graph degree + telemetry leverage.');
  lines.push('- Relevance lists which repos/projects the skill most directly governs in practice.');
  lines.push('- This file is a queue contract, not a prose inventory. Work one skill at a time.');
  lines.push('');

  const bands = ['critical', 'high', 'medium', 'low'];
  for (const band of bands) {
    const entries = worklist.worklist.filter((entry) => entry.importanceBand === band);
    if (entries.length === 0) continue;
    lines.push(`## ${band.charAt(0).toUpperCase() + band.slice(1)} (${entries.length})`);
    lines.push('');
    lines.push('| Rank | Skill | Status | Version | Claimed | Last Updated | Category | Repos | Score | Why Now |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const entry of entries) {
      const statusLabel = entry.upgraded ? 'upgraded' : entry.status;
      const versionLabel = entry.upgradedVersion || entry.skillVersion || '';
      const claimedLabel = entry.claimed ? (entry.claimedAt || 'yes') : '';
      lines.push(`| ${entry.rank} | \`${entry.skill}\` | ${renderCell(statusLabel)} | ${renderCell(versionLabel)} | ${renderCell(claimedLabel)} | ${renderCell(entry.lastUpdated)} | ${renderCell(entry.primaryCategory)} | ${renderCell(entry.projectRelevance.join(', '))} | ${entry.importanceScore} | ${renderCell(entry.reasons.join('; '))} |`);
    }
    lines.push('');
  }

  lines.push('## Per-Skill Contract');
  lines.push('');
  lines.push('Every item in the JSON worklist carries the same four-step execution contract:');
  lines.push('');
  lines.push('1. Research the skill against live repo truth first.');
  lines.push('2. Research the external domain or vendor docs second.');
  lines.push('3. Update `SKILL.md` and evals in the same pass.');
  lines.push('4. Fix confirmed repo/codebase drift that the audit uncovers.');
  lines.push('');
  lines.push(`JSON source: \`${path.relative(REPO_ROOT, DEFAULT_JSON_OUT)}\``);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function renderPublicationMarkdown(worklist) {
  const lines = [];
  lines.push('# Marketplace Publication Queue (generated)');
  lines.push('');
  lines.push(`Generated: ${worklist.generated_at}`);
  lines.push(`Schema: ${worklist.schema_version}`);
  lines.push(`Generator: skill-audit-loop@${worklist.generator_version || 'unknown'}`);
  lines.push(`Source ledger: \`${worklist.publication_ledger || 'skill-graph/data/publication-classification.json'}\``);
  lines.push('');
  lines.push('> Auto-generated from `skill-graph/data/publication-classification.json` by');
  lines.push('> `skill-audit-loop/src/build-skill-audit-worklist.js`. Do not hand-edit — re-run');
  lines.push('> `node scripts/skill/build-skill-audit-worklist.js --write` after editing the ledger.');
  lines.push('');

  const summary = worklist.summary?.publication;
  if (summary) {
    lines.push('## Summary');
    lines.push('');
    lines.push(`- Publishable candidates: ${summary.publishable}`);
    lines.push(`- Sales-Hub-bound (excluded): ${summary.salesHubBound}`);
    lines.push(`- Personal-infra (excluded): ${summary.personalInfra}`);
    lines.push(`- Already published (in OSS export): ${summary.alreadyPublished}`);
    lines.push(`- Tier counts: S=${summary.tiers.S} A=${summary.tiers.A} B=${summary.tiers.B} C=${summary.tiers.C}`);
    lines.push(`- Ledger entries total: ${summary.ledgerEntries}`);
    lines.push('');
  }

  const tiers = [
    ['S', 'Tier S — Publish immediately (5★)'],
    ['A', 'Tier A — High demand, second wave (4★)'],
    ['B', 'Tier B — Standard utility (3★)'],
    ['C', 'Tier C — Niche but publishable (2★)'],
  ];

  for (const [tierKey, heading] of tiers) {
    const entries = worklist.publicationQueue.filter((e) => e.tier === tierKey);
    if (entries.length === 0) continue;
    lines.push(`## ${heading} (n=${entries.length})`);
    lines.push('');
    lines.push('| Rank | Skill | Pop | Source | Sanitize? | Demand | In Export | Audit Rank | Notes |');
    lines.push('| --- | --- | ---: | --- | --- | --- | ---: | ---: | --- |');
    for (const e of entries) {
      const skillLabel = e.rename_to ? `\`${e.skill}\` *(→ ${e.rename_to})*` : `\`${e.skill}\``;
      lines.push(
        `| ${e.rank} | ${skillLabel} | ${e.pop_score ?? ''} | ${renderCell(e.source)} | ${renderCell(e.needs_sanitization)} | ${renderCell(e.demand_signal)} | ${e.included_in_export ? 'yes' : 'no'} | ${renderCell(e.worklist_rank)} | ${renderCell(e.notes)} |`,
      );
    }
    lines.push('');
  }

  if (worklist.conflicts && worklist.conflicts.length > 0) {
    lines.push(`## Conflicts (${worklist.conflicts.length})`);
    lines.push('');
    lines.push('Ledger classification disagrees with manifest scope. Resolve before next publication batch.');
    lines.push('');
    lines.push('| Skill | Ledger | Manifest Scope | Reason |');
    lines.push('| --- | --- | --- | --- |');
    for (const c of worklist.conflicts) {
      lines.push(`| \`${c.skill}\` | ${renderCell(c.ledger_classification)} | ${renderCell(c.manifest_repo_scope)} | ${renderCell(c.reason)} |`);
    }
    lines.push('');
  }

  if (worklist.publication_orphans && worklist.publication_orphans.length > 0) {
    lines.push(`## Orphan ledger entries (${worklist.publication_orphans.length})`);
    lines.push('');
    lines.push('Ledger names skills not present in the active manifest or marketplace export. Likely archived or stale.');
    lines.push('');
    for (const skill of worklist.publication_orphans) {
      lines.push(`- \`${skill}\``);
    }
    lines.push('');
  }

  lines.push('## Supersedes');
  lines.push('');
  for (const s of worklist.supersedes || []) {
    lines.push(`- \`${s}\``);
  }
  if (!worklist.supersedes || worklist.supersedes.length === 0) {
    lines.push('- (none)');
  }
  lines.push('');

  return `${lines.join('\n')}\n`;
}

function writeOutputs(worklist, jsonOut, mdOut, publicationMdOut) {
  ensureParent(jsonOut);
  ensureParent(mdOut);
  fs.writeFileSync(jsonOut, JSON.stringify(worklist, null, 2) + '\n', 'utf8');
  fs.writeFileSync(mdOut, renderMarkdown(worklist), 'utf8');
  if (publicationMdOut && worklist.publicationQueue && worklist.publicationQueue.length > 0) {
    ensureParent(publicationMdOut);
    fs.writeFileSync(publicationMdOut, renderPublicationMarkdown(worklist), 'utf8');
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    console.log([
      'build-skill-audit-worklist.js',
      '',
      'Usage:',
      '  node scripts/skill/build-skill-audit-worklist.js --write',
      '  node scripts/skill/build-skill-audit-worklist.js --json',
      '  node scripts/skill/build-skill-audit-worklist.js --json-out /tmp/worklist.json --md-out /tmp/worklist.md --write',
      '',
      'Flags:',
      '  --write                   Persist worklist JSON + audit MD + publication MD',
      '  --json                    Emit full worklist JSON to stdout',
      '  --json-out <path>         Override default JSON output path',
      '  --md-out <path>           Override default audit MD output path',
      '  --publication-md-out <p>  Override default publication MD output path',
      '  --skip-publication        Skip publicationQueue/conflicts and the publication MD',
      '',
      'Outputs:',
      `  JSON:           ${path.relative(REPO_ROOT, DEFAULT_JSON_OUT)}`,
      `  Audit MD:       ${path.relative(REPO_ROOT, DEFAULT_MD_OUT)}`,
      `  Publication MD: ${path.relative(REPO_ROOT, DEFAULT_PUBLICATION_MD_OUT)}`,
    ].join('\n'));
    return;
  }

  const manifest = loadManifest();
  const worklist = buildWorklist(manifest, args);
  const jsonOut = args['json-out'] ? path.resolve(args['json-out']) : DEFAULT_JSON_OUT;
  const mdOut = args['md-out'] ? path.resolve(args['md-out']) : DEFAULT_MD_OUT;
  const publicationMdOut = args['publication-md-out']
    ? path.resolve(args['publication-md-out'])
    : DEFAULT_PUBLICATION_MD_OUT;

  if (args.write) {
    writeOutputs(worklist, jsonOut, mdOut, publicationMdOut);
  }

  if (args.json || !args.write) {
    process.stdout.write(JSON.stringify(worklist, null, 2) + '\n');
    return;
  }

  const wroteParts = [
    path.relative(REPO_ROOT, jsonOut),
    path.relative(REPO_ROOT, mdOut),
  ];
  if (worklist.publicationQueue && worklist.publicationQueue.length > 0) {
    wroteParts.push(path.relative(REPO_ROOT, publicationMdOut));
  }
  process.stdout.write(`Wrote skill audit worklist to ${wroteParts.join(', ')}\n`);
  if (worklist.conflicts && worklist.conflicts.length > 0) {
    process.stdout.write(`Note: ${worklist.conflicts.length} publication conflict(s) detected — see conflicts[] in JSON or the Conflicts section in the publication MD.\n`);
  }
  if (worklist.publication_orphans && worklist.publication_orphans.length > 0) {
    process.stdout.write(`Note: ${worklist.publication_orphans.length} ledger orphan(s) — skills named in ledger but absent from manifest and export.\n`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || String(error));
    process.exit(1);
  }
}

module.exports = {
  buildWorklist,
  buildResearchQueries,
  importanceBandFromRank,
  inferProjectRelevance,
  main,
  renderMarkdown,
  renderPublicationMarkdown,
  scoreSkill,
  loadPublicationLedger,
  loadPublishedSet,
  buildPublicationQueue,
  SCHEMA_VERSION,
  SUPERSEDES,
  CHANGELOG_SUMMARY,
};
