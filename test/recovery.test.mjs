import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePage } from '../lib/stagedWriter.mjs';
import { buildFallbackWriterDraft } from '../lib/fallbackWriter.mjs';
import { isLegacyJob, newJob, nextStage } from '../lib/automationRunner.mjs';

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
    { id: 'source-1', title: 'Primary', publisher: 'Agency', url: 'https://example.com/1', kind: 'primary' },
    { id: 'source-2', title: 'Report', publisher: 'Media', url: 'https://example.com/2', kind: 'reliable_media' },
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

test('old four-scope jobs are superseded', () => {
  assert.equal(isLegacyJob({ mode: 'legacy', scopes: { global: {}, japan: {} } }), true);
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
