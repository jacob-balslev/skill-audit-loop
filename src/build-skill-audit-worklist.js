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

  return {
    generatedAt: new Date().toISOString(),
    source: 'skill-audit-loop/src/build-skill-audit-worklist.js',
    entrypoint: 'scripts/skill/build-skill-audit-worklist.js',
    summary: {
      activeSkills: manifest.summary?.active || ranked.length,
      salesHubSkills: manifest.summary?.salesHub || 0,
      sharedSkills: manifest.summary?.shared || 0,
      bands: countsByBand,
      pendingBands: pendingCountsByBand,
      status: countsByStatus,
    },
    rankingMethod: {
      categoryWeights: CATEGORY_WEIGHTS,
      routingWeights: ROUTING_WEIGHTS,
      typeWeights: TYPE_WEIGHTS,
      repoScopeWeights: REPO_SCOPE_WEIGHTS,
      leverageSource: 'scripts/skill/skill-leverage-ranker.js',
    },
    worklist: ranked,
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

function writeOutputs(worklist, jsonOut, mdOut) {
  ensureParent(jsonOut);
  ensureParent(mdOut);
  fs.writeFileSync(jsonOut, JSON.stringify(worklist, null, 2) + '\n', 'utf8');
  fs.writeFileSync(mdOut, renderMarkdown(worklist), 'utf8');
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
    ].join('\n'));
    return;
  }

  const manifest = loadManifest();
  const worklist = buildWorklist(manifest, args);
  const jsonOut = args['json-out'] ? path.resolve(args['json-out']) : DEFAULT_JSON_OUT;
  const mdOut = args['md-out'] ? path.resolve(args['md-out']) : DEFAULT_MD_OUT;

  if (args.write) {
    writeOutputs(worklist, jsonOut, mdOut);
  }

  if (args.json || !args.write) {
    process.stdout.write(JSON.stringify(worklist, null, 2) + '\n');
    return;
  }

  process.stdout.write(`Wrote skill audit worklist to ${path.relative(REPO_ROOT, jsonOut)} and ${path.relative(REPO_ROOT, mdOut)}\n`);
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
  scoreSkill,
};
