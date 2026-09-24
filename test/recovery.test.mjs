import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePage } from '../lib/stagedWriter.mjs';
import { buildFallbackWriterDraft } from '../lib/fallbackWriter.mjs';
import { alignWriterDraftToJobDate, buildResearchFailureObservation, isLegacyJob, newJob, nextStage, resumeFailedCheckpoint } from '../lib/automationRunner.mjs';
import { auditCandidateSources, selectDiverseQualifiedCandidates } from '../lib/researchQuality.mjs';
import { buildPublicContent } from '../lib/publicContent.mjs';
import { mergeApprovedDraft, mergeRejectedDraft } from '../lib/publisher.mjs';
import { buildCorroboratedPairs, gdeltWindow, parseFeed } from '../lib/gdeltResearch.mjs';
import { shiftDate } from '../api/daily.mjs';
import { chooseBalancedCandidate } from '../api/analyze.mjs';
import { analyzeCandidate } from '../lib/analyst.mjs';

const candidate = {
  id: 'signal-test',
  date: '2026-08-20',
  importance: 78,
  novelty: 70,
  evidenceStrength: 76,
  thesisImpact: 65,
  suggestedProcessId: 'process-ai-infrastructure-race',
  content: {
    en: {
      title: 'AI infrastructure financing is changing',
      coreFact: 'Two independent sources reported a new financing structure.',
      whyItMatters: 'Capital is becoming part of the infrastructure bottleneck.',
      processMatchReason: 'This updates the AI infrastructure race.',
    },
    zh: {
      title: 'AI 基础设施融资正在变化',
      coreFact: '两个独立来源报道了新的融资结构。',
      whyItMatters: '资本正在成为基础设施瓶颈的一部分。',
      processMatchReason: '这更新了 AI 基础设施竞赛进程。',
    },
  },
  analysis: {
    dailyState: 'update_living',
    matchedProcessId: 'process-ai-infrastructure-race',
    publishThresholdMet: true,
    materialChangeScore: 68,
    impact: 'updates',
    rationale: 'Independent evidence supports a material update.',
  },
  sources: [
    { id: 'source-1', title: 'Primary', publisher: 'Agency', evidenceOrigin: 'Agency dataset', url: 'https://agency.gov/report', kind: 'primary', publishedAt: '2026-08-20' },
    { id: 'source-2', title: 'Report', publisher: 'Media', evidenceOrigin: 'Independent market survey', url: 'https://reuters.com/report', kind: 'reliable_media', publishedAt: '2026-08-20' },
  ],
};

test('new automation jobs are Global EN/ZH only', () => {
  const job = newJob({ date: '2026-08-20', baseUrl: 'https://example.com' });
  assert.deepEqual(Object.keys(job.scopes), ['global']);
  assert.equal(job.mode, 'global_en_zh');
  assert.equal(nextStage('write_zh'), 'write_finalize');
  assert.notEqual(nextStage('write_zh'), 'write_ja');
  assert.equal(isLegacyJob(job), false);
});

test('source gate rejects placeholders and duplicate publishers', () => {
  const bad = { ...candidate, sources: [
    { publisher: 'Same', url: 'https://example.com/a', kind: 'primary' },
    { publisher: 'Same', url: 'https://same.news/b', kind: 'reliable_media' },
  ] };
  assert.equal(auditCandidateSources(bad, '2026-08-20').ok, false);
  assert.equal(selectDiverseQualifiedCandidates([bad], '2026-08-20').length, 0);
});

test('source gate accepts two independent current URLs', () => {
  assert.equal(auditCandidateSources(candidate, '2026-08-20').ok, true);
});

test('a well-evidenced trend advance is publishable without a world-scale structural turn', () => {
  const analyzed = analyzeCandidate({
    ...candidate,
    suggestedProcessId: null,
    processMatchConfidence: 0,
    importance: 68,
    novelty: 58,
    evidenceStrength: 78,
    thesisImpact: 32,
    relationshipChange: 35,
    stageChange: 30,
    contradiction: 10,
  }, '2026-08-20', []);
  assert.equal(analyzed.analysis.dailyState, 'publish_new');
  assert.equal(analyzed.analysis.publishThresholdMet, true);
});

test('candidate pool protects distinct domains before adding a second topic', () => {
  const make = (id, domain, importance) => ({ ...candidate, id, domain, importance });
  const selected = selectDiverseQualifiedCandidates([
    make('ai-1', 'technology-ai', 99),
    make('ai-2', 'technology-ai', 98),
    make('health-1', 'health-science', 70),
    make('city-1', 'urban-infrastructure', 69),
  ], '2026-08-20', 3);
  assert.deepEqual(new Set(selected.map((item) => item.domain)), new Set([
    'technology-ai', 'health-science', 'urban-infrastructure',
  ]));
});

test('high-salience topics must clearly outperform quieter domains', () => {
  const analyzed = (id, domain, priority) => ({
    ...candidate,
    id,
    domain,
    analysis: { ...candidate.analysis, priorityScore: priority, materialChangeScore: 60 },
  });
  const selected = chooseBalancedCandidate([
    analyzed('conflict', 'geopolitics-security', 84),
    analyzed('health', 'health-science', 80),
  ], 'conflict');
  assert.equal(selected.id, 'health');
});

test('source gate admits two publishers while preserving origin concentration for analysis', () => {
  const repeated = {
    ...candidate,
    sources: candidate.sources.map((source) => ({
      ...source,
      evidenceOrigin: 'Same agency announcement',
    })),
  };
  const audit = auditCandidateSources(repeated, '2026-08-20');
  assert.equal(audit.ok, true);
  assert.equal(audit.independentSourceCount, 2);
  assert.equal(audit.distinctEvidenceOriginCount, 1);
});

test('old four-scope jobs are superseded', () => {
  assert.equal(isLegacyJob({ mode: 'legacy', scopes: { global: {}, japan: {} } }), true);
});

test('legacy completed-with-errors research is retried from research', () => {
  const job = newJob({ date: '2026-09-05', baseUrl: 'https://example.com' });
  job.status = 'completed_with_errors';
  job.currentStage = 'complete';
  job.completedAt = '2026-09-05T00:00:00.000Z';
  job.scopes.global.status = 'checkpointed';
  job.scopes.global.stage = 'complete';
  job.scopes.global.failedStage = 'research';
  job.scopes.global.attempts = { research: 3 };

  assert.deepEqual(resumeFailedCheckpoint(job), { scope: 'global', stage: 'research' });
  assert.equal(job.status, 'running');
  assert.equal(job.currentStage, 'research');
  assert.equal(job.scopes.global.attempts.research, 0);
  assert.equal(job.completedAt, undefined);
});

test('exhausted research is retried after the external failure is repaired', () => {
  const job = newJob({ date: '2026-09-09', baseUrl: 'https://example.com' });
  job.status = 'failed';
  job.scopes.global.status = 'error';
  job.scopes.global.failedStage = 'research';
  job.scopes.global.attempts = { research: 3 };
  job.scopes.global.message = 'upstream timeout';
  assert.deepEqual(resumeFailedCheckpoint(job), { scope: 'global', stage: 'research' });
  assert.equal(job.currentStage, 'research');
  assert.equal(job.scopes.global.attempts.research, 0);
});

test('fallback writer produces complete English and Chinese pages', () => {
  const draft = buildFallbackWriterDraft({
    id: 'research-test',
    researchDate: '2026-08-20',
    candidates: [candidate],
  });
  validatePage(draft.insight.content.en, 'en');
  validatePage(draft.insight.content.zh, 'zh');
  assert.equal(draft.provider, 'deterministic-fallback');
  assert.equal(draft.pipeline, 'build014.2-recovery');
  assert.equal(draft.qualityChecks.languagesComplete, true);
});

test('approved insight uses the editorial publication time, not the event date', () => {
  const current = {
    schemaVersion: 1,
    insights: [],
    dailyStates: [],
    writerDrafts: [],
  };
  const draft = {
    id: 'writer-date-test',
    insight: {
      id: 'insight-date-test',
      publishedAt: '2026-09-20T00:00:00.000Z',
    },
    dailyStateDraft: {
      id: 'daily-global-2026-09-21',
      date: '2026-09-21',
    },
  };
  const publishedAt = '2026-09-21T03:00:00.000Z';
  const next = mergeApprovedDraft(current, draft, publishedAt);
  assert.equal(next.insights[0].publishedAt, '2026-09-21T03:00:00.000Z');
  assert.equal(next.insights[0].updatedAt, publishedAt);
  assert.equal(next.writerDrafts[0].insight.publishedAt, '2026-09-21T03:00:00.000Z');
});

test('scheduled job date overrides model event date before publication', () => {
  const draft = alignWriterDraftToJobDate({
    id: 'writer-event-date',
    insight: { id: 'global-event', publishedAt: '2026-09-22T00:00:00.000Z' },
    dailyStateDraft: { id: 'daily-global-2026-09-22', date: '2026-09-22' },
  }, '2026-09-24');

  assert.equal(draft.dailyStateDraft.id, 'daily-global-2026-09-24');
  assert.equal(draft.dailyStateDraft.date, '2026-09-24');
  assert.equal(draft.insight.publishedAt, '2026-09-24T03:00:00.000Z');
});

test('public content excludes editorial drafts and unused candidates', () => {
  const content = {
    schemaVersion: 1,
    generatedAt: '2026-09-05T00:00:00.000Z',
    contentVersion: 'test',
    insights: [{ id: 'insight-1', content: { en: { title: 'EN' }, zh: { title: 'ZH' }, ja: { title: 'JA' } } }],
    worldProcesses: [{ id: 'process-1' }],
    dailyStates: [{ id: 'state-1', candidateSignalIds: ['kept'] }],
    dailyCandidates: [{ id: 'kept' }, { id: 'unused' }],
    researchDrafts: [{ id: 'research-secret' }],
    writerDrafts: [{ id: 'writer-secret' }],
  };
  const result = buildPublicContent(content);
  assert.deepEqual(result.dailyCandidates.map((item) => item.id), ['kept']);
  assert.equal('researchDrafts' in result, false);
  assert.equal('writerDrafts' in result, false);
  assert.equal('ja' in result.insights[0].content, false);
});

test('rejected no-new draft still publishes the daily observation', () => {
  const current = {
    schemaVersion: 1,
    generatedAt: '2026-09-04T00:00:00.000Z',
    contentVersion: 'old',
    insights: [{ id: 'previous-insight' }],
    worldProcesses: [],
    dailyStates: [{ id: 'previous-state', date: '2026-09-04' }],
    writerDrafts: [],
  };
  const draft = {
    id: 'writer-2026-09-05',
    dailyState: 'no_new_global_insight',
    dailyStateDraft: {
      id: 'state-2026-09-05',
      date: '2026-09-05',
      insightId: 'unpublished-insight',
      processId: 'unpublished-process',
    },
  };
  const next = mergeRejectedDraft(current, draft, '2026-09-05T00:00:00.000Z');
  assert.equal(next.insights[0].id, 'previous-insight');
  assert.equal(next.dailyStates[0].id, 'state-2026-09-05');
  assert.equal(next.dailyStates[0].insightId, undefined);
  assert.equal(next.dailyStates[0].processId, undefined);
  assert.equal(next.dailyStates[0].previousInsightId, 'previous-insight');
  assert.equal(next.dailyStates[0].decidedAt, '2026-09-05T00:00:00.000Z');
  assert.equal(next.writerDrafts[0].status, 'rejected');
});

test('rejected under-threshold insight becomes a no-new daily observation', () => {
  const current = {
    schemaVersion: 1,
    insights: [{ id: 'previous-insight' }],
    worldProcesses: [],
    dailyStates: [],
    writerDrafts: [],
  };
  const draft = {
    id: 'writer-under-threshold',
    dailyState: 'publish_new',
    dailyStateDraft: {
      id: 'daily-global-2026-09-10',
      date: '2026-09-10',
      state: 'publish_new',
      insightId: 'unpublished-insight',
      content: {
        en: { label: 'Publish', decisionTitle: 'Publish', decisionSummary: 'Candidate', thresholdReason: 'Evidence is preliminary.' },
        zh: { label: '发布', decisionTitle: '发布', decisionSummary: '候选', thresholdReason: '证据仍属初步。' },
      },
    },
  };
  const next = mergeRejectedDraft(current, draft, '2026-09-10T03:00:00.000Z');
  assert.equal(next.dailyStates[0].state, 'no_new_global_insight');
  assert.equal(next.dailyStates[0].insightId, undefined);
  assert.equal(next.dailyStates[0].previousInsightId, 'previous-insight');
  assert.equal(next.dailyStates[0].content.zh.label, '今日未形成新结构性洞察');
});

test('daily observations stay newest-first and repair a missing language', () => {
  const current = {
    schemaVersion: 1,
    insights: [{ id: 'previous-insight' }],
    worldProcesses: [],
    dailyStates: [
      { id: 'daily-global-2026-09-10', date: '2026-09-10', content: { en: {}, zh: {} } },
      { id: 'daily-global-2026-09-08', date: '2026-09-08', content: { en: {} } },
    ],
    writerDrafts: [],
  };
  const draft = {
    id: 'writer-2026-09-08',
    dailyState: 'publish_new',
    dailyStateDraft: {
      id: 'daily-global-2026-09-08',
      date: '2026-09-08',
      state: 'publish_new',
      content: { en: { thresholdReason: 'Not enough evidence.' } },
    },
  };
  const next = mergeRejectedDraft(current, draft);
  assert.deepEqual(next.dailyStates.map((item) => item.date), ['2026-09-10', '2026-09-08']);
  assert.equal(next.dailyStates[1].content.zh.label, '今日未形成新结构性洞察');
});

test('Japan-morning research scans records that already exist in UTC', () => {
  const window = gdeltWindow(
    '2026-09-06',
    Date.parse('2026-09-05T22:00:00.000Z'),
  );
  assert.deepEqual(window, {
    startdatetime: '20260904100000',
    enddatetime: '20260905220000',
  });
});

test('daily backlog dates cross month boundaries safely', () => {
  assert.equal(shiftDate('2026-09-01', -2), '2026-08-30');
  assert.equal(shiftDate('2027-01-01', -1), '2026-12-31');
});

test('publisher RSS backup keeps only records in the requested window', () => {
  const xml = `<rss><channel>
    <item><title><![CDATA[Current &amp; useful]]></title><link>https://news.example/current</link><pubDate>Tue, 08 Sep 2026 00:00:00 GMT</pubDate></item>
    <item><title>Too old</title><link>https://news.example/old</link><pubDate>Tue, 01 Sep 2026 00:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const result = parseFeed(xml, 'health-science', '2026-09-08', Date.parse('2026-09-08T03:00:00Z'));
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Current & useful');
  assert.equal(result[0].bucket, 'health-science');
});

test('research dossier surfaces likely cross-publisher corroboration', () => {
  const pairs = buildCorroboratedPairs([
    { bucket: 'macro-finance', title: 'Federal Reserve rate hike reflects sticky inflation', url: 'https://apnews.com/fed', publisher: 'apnews.com' },
    { bucket: 'macro-finance', title: 'Fed official says inflation remains high after rate hike', url: 'https://reuters.com/fed', publisher: 'reuters.com' },
    { bucket: 'climate-environment', title: 'Unrelated storm reaches coast', url: 'https://bbc.co.uk/storm', publisher: 'bbc.co.uk' },
  ]);
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].sources.map((source) => source.publisher), ['apnews.com', 'reuters.com']);
});

test('research outage creates an honest no-claim daily observation', () => {
  const draft = buildResearchFailureObservation('2026-09-09', new Error('upstream timeout'));
  assert.equal(draft.dailyState, 'no_new_global_insight');
  assert.equal(draft.dailyStateDraft.date, '2026-09-09');
  assert.equal(draft.dailyStateDraft.candidateSignalIds.length, 0);
  assert.match(draft.dailyStateDraft.content.zh.decisionTitle, /研究阶段/);
});
