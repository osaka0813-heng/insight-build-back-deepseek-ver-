import fs from 'node:fs';
import path from 'node:path';

const [draftPath, contentPath = '../remote-content.json'] = process.argv.slice(2);
if (!draftPath) {
  console.error('Usage: node scripts/merge-research-draft.mjs <draft.json> [remote-content.json]');
  process.exit(1);
}
const absoluteDraft = path.resolve(process.cwd(), draftPath);
const absoluteContent = path.resolve(process.cwd(), contentPath);
const draft = JSON.parse(fs.readFileSync(absoluteDraft, 'utf8'));
const content = JSON.parse(fs.readFileSync(absoluteContent, 'utf8'));
const drafts = Array.isArray(content.researchDrafts) ? content.researchDrafts : [];
content.researchDrafts = [draft, ...drafts.filter((item) => item.id !== draft.id)];
content.generatedAt = new Date().toISOString();
content.contentVersion = `${content.contentVersion}-research-${Date.now()}`;
fs.writeFileSync(absoluteContent, `${JSON.stringify(content, null, 2)}\n`);
console.log(`Merged ${draft.id} into ${absoluteContent}`);
