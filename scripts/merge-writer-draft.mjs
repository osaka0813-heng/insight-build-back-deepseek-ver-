import fs from 'node:fs';
import path from 'node:path';

const [writerPath, contentPath = './remote-content.json'] = process.argv.slice(2);
if (!writerPath) {
  console.error('Usage: node scripts/merge-writer-draft.mjs <writer-draft.json> [remote-content.json]');
  process.exit(1);
}

const writerPayload = JSON.parse(fs.readFileSync(path.resolve(writerPath), 'utf8'));
const writerDraft = writerPayload.writerDraft || writerPayload;
const content = JSON.parse(fs.readFileSync(path.resolve(contentPath), 'utf8'));

if (!writerDraft?.insight || !writerDraft?.dailyStateDraft) {
  throw new Error('writerDraft.insight and writerDraft.dailyStateDraft are required.');
}
if (writerDraft.status !== 'approved') {
  throw new Error('Writer draft must be manually changed to status: approved before merging.');
}

content.insights = [writerDraft.insight, ...content.insights.filter((item) => item.id !== writerDraft.insight.id)];
content.dailyStates = [writerDraft.dailyStateDraft, ...content.dailyStates.filter((item) => item.id !== writerDraft.dailyStateDraft.id)];

if (writerDraft.processUpdate) {
  content.worldProcesses = content.worldProcesses.map((process) => {
    if (process.id !== writerDraft.processUpdate.processId) return process;
    return {
      ...process,
      updatedAt: writerDraft.processUpdate.updatedAt,
      insightIds: Array.from(new Set([writerDraft.processUpdate.appendInsightId, ...(process.insightIds || [])])),
      evolution: [writerDraft.processUpdate.evolutionEvent, ...(process.evolution || []).filter((event) => event.id !== writerDraft.processUpdate.evolutionEvent.id)],
      content: Object.fromEntries(Object.entries(process.content).map(([language, copy]) => [language, {
        ...copy,
        nextQuestion: writerDraft.processUpdate.nextQuestion?.[language] || copy.nextQuestion,
        observeNext: writerDraft.processUpdate.observeNext?.[language] || copy.observeNext,
      }])),
    };
  });
}

content.generatedAt = new Date().toISOString();
content.contentVersion = `writer-${writerDraft.id}`;
content.writerDrafts = [writerDraft, ...(content.writerDrafts || []).filter((item) => item.id !== writerDraft.id)];

fs.writeFileSync(path.resolve(contentPath), JSON.stringify(content, null, 2) + '\n');
console.log(`Merged approved writer draft into ${contentPath}`);
