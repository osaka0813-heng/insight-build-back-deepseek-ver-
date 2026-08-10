import { normalizeScope, processCatalogForScope, scopeLabel } from '../lib/processScopes.mjs';
import { compactUsage, deepseekConfig, deepseekResponsesJSON, deepseekResponsesText } from '../lib/deepseekClient.mjs';

const ALLOWED_METHODS = 'POST, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, x-research-token';

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
  res.setHeader('Access-Control-Max-Age', '86400');
}
function sendJson(res,status,body) { setCorsHeaders(res); res.status(status); res.setHeader('Content-Type','application/json; charset=utf-8'); res.end(JSON.stringify(body)); }
function parseBody(req) { if(!req.body) return {}; if(typeof req.body==='object') return req.body; try { return JSON.parse(req.body); } catch { const e=new Error('Request body must be valid JSON.'); e.status=400; throw e; } }

const candidateSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['querySummary', 'candidates'],
  properties: {
    querySummary: {
      type: 'string',
    },
    candidates: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'date',
          'domain',
          'tags',
          'suggestedProcessId',
          'processMatchConfidence',
          'importance',
          'novelty',
          'evidenceStrength',
          'independentSourceCount',
          'thesisImpact',
          'relationshipChange',
          'stageChange',
          'contradiction',
          'content',
          'sources',
        ],
        properties: {
          id: { type: 'string' },
          date: { type: 'string' },
          domain: { type: 'string' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            minItems: 2,
            maxItems: 10,
          },
          suggestedProcessId: {
            type: ['string', 'null'],
          },
          processMatchConfidence: {
            type: 'integer',
            minimum: 0,
            maximum: 100,
          },
          importance: {
            type: 'integer',
            minimum: 0,
            maximum: 100,
          },
          novelty: {
            type: 'integer',
            minimum: 0,
            maximum: 100,
          },
          evidenceStrength: {
            type: 'integer',
            minimum: 0,
            maximum: 100,
          },
          independentSourceCount: {
            type: 'integer',
            minimum: 1,
            maximum: 10,
          },
          thesisImpact: {
            type: 'integer',
            minimum: 0,
            maximum: 100,
          },
          relationshipChange: {
            type: 'integer',
            minimum: 0,
            maximum: 100,
          },
          stageChange: {
            type: 'integer',
            minimum: 0,
            maximum: 100,
          },
          contradiction: {
            type: 'integer',
            minimum: 0,
            maximum: 100,
          },
          content: {
            type: 'object',
            additionalProperties: false,
            required: ['en', 'zh', 'ja'],
            properties: {
              en: { $ref: '#/$defs/copy' },
              zh: { $ref: '#/$defs/copy' },
              ja: { $ref: '#/$defs/copy' },
            },
          },
          sources: {
            type: 'array',
            minItems: 2,
            maxItems: 6,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['title', 'url', 'publisher', 'publishedAt', 'kind'],
              properties: {
                title: { type: 'string' },
                url: { type: 'string' },
                publisher: { type: 'string' },
                publishedAt: {
                  type: ['string', 'null'],
                },
                kind: {
                  type: 'string',
                  enum: ['primary', 'reliable_media', 'context'],
                },
              },
            },
          },
        },
      },
    },
  },
  $defs: {
    copy: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'coreFact', 'whyItMatters', 'processMatchReason'],
      properties: {
        title: { type: 'string' },
        coreFact: { type: 'string' },
        whyItMatters: { type: 'string' },
        processMatchReason: { type: 'string' },
      },
    },
  },
};

function validateResearchDraft(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('DeepSeek Research returned no JSON object.');
  }

  if (
    typeof value.querySummary !== 'string' ||
    !value.querySummary.trim()
  ) {
    throw new Error(
      'DeepSeek Research JSON is missing querySummary.',
    );
  }

  if (
    !Array.isArray(value.candidates) ||
    value.candidates.length === 0
  ) {
    throw new Error(
      'DeepSeek Research JSON contains no candidates.',
    );
  }

  for (const [index, candidate] of value.candidates.entries()) {
    if (!candidate || typeof candidate !== 'object') {
      throw new Error(
        `DeepSeek Research candidate ${index + 1} is invalid.`,
      );
    }

    if (
      !candidate.content?.en ||
      !candidate.content?.zh ||
      !candidate.content?.ja
    ) {
      throw new Error(
        `DeepSeek Research candidate ${index + 1} is missing multilingual content.`,
      );
    }

    if (
      !Array.isArray(candidate.sources) ||
      candidate.sources.length < 2
    ) {
      throw new Error(
        `DeepSeek Research candidate ${index + 1} has fewer than two sources.`,
      );
    }
  }

  return value;
}

async function callDeepSeek({
  date,
  focus,
  existingProcesses,
  maxSignals,
  scope,
}) {
  const config = deepseekConfig();
  const scopeName = scopeLabel(scope);
  const processContext = existingProcesses.length
    ? JSON.stringify(existingProcesses)
    : `No existing ${scopeName} Process catalogue was supplied.`;

  const searchInstructions = [
    'You are the evidence-gathering stage for Insight.',
    `The active research scope is ${scopeName}.`,
    scope === 'japan'
      ? 'Prioritize changes that alter Japan-specific systems, institutions, markets, policy regimes, industrial capacity, demographics, energy, security or capital flows. Global events matter only when they materially change a Japan process.'
      : scope === 'china'
        ? 'Prioritize changes that alter China-specific macro, property, local-finance, industrial, technology, household-demand, trade or capital systems. Global events matter only when they materially change a China process.'
        : scope === 'us'
          ? 'Prioritize changes that alter United States fiscal, monetary, labor, industrial, AI-infrastructure, energy, trade or capital systems. Global events matter only when they materially change a US process.'
          : 'Prioritize world-process-level structural changes with cross-border or system-wide significance.',
    `Search public information published or materially updated near ${date}.`,
    'Collect candidate changes, not finished Insights.',
    'Prefer primary sources and high-quality independent reporting.',
    'Record exact source title, publisher, URL, and publication date.',
    'Do not invent facts or URLs.',
    'This stage may return readable research notes; it does not need to return JSON.',
  ].join(' ');

  const task = [
    `Research date: ${date}`,
    `Research scope: ${scopeName}`,
    `Research focus: ${focus}`,
    `Existing ${scopeName} Processes: ${processContext}`,
    `Find evidence for up to ${maxSignals} distinct candidate signals.`,
  ].join('\n');

  const evidence = await deepseekResponsesText({
    model: config.researchModel,
    instructions: searchInstructions,
    input: task,
    webSearch: true,
    maxOutputTokens: 12_000,
  });

  const formatInstructions = [
    'You are the structuring stage for Insight Research.',
    'Use only the supplied web-search dossier.',
    'Convert the dossier into candidate signals, not finished Insights.',
    'Every candidate must describe a verifiable change rather than a general trend.',
    'Never invent URLs, titles, publishers, publication dates, quotes, or numeric facts.',
    'Use at least two genuinely independent sources per candidate.',
    'Return English, Simplified Chinese, and Japanese copy.',
    'Scores use 0-100.',
    'All output is a draft requiring human approval.',
  ].join(' ');

  const structured = await deepseekResponsesJSON({
    model: config.researchModel,
    instructions: formatInstructions,
    input: [
      task,
      '',
      'WEB SEARCH DOSSIER:',
      evidence.text,
      '',
      `Return 1 to ${maxSignals} distinct signals.`,
    ].join('\n'),
    schema: candidateSchema,
    schemaName: 'insight_research_draft',
    maxOutputTokens: 18_000,
  });

  return {
    ...structured,
    data: validateResearchDraft(structured.data),
    usage: {
      input_tokens:
        (evidence.usage?.input_tokens || 0) +
        (structured.usage?.input_tokens || 0),
      output_tokens:
        (evidence.usage?.output_tokens || 0) +
        (structured.usage?.output_tokens || 0),
      input_tokens_details: {
        cached_tokens:
          (evidence.usage?.input_tokens_details?.cached_tokens || 0) +
          (structured.usage?.input_tokens_details?.cached_tokens || 0),
      },
    },
  };
}

export default async function handler(req,res) {
  setCorsHeaders(res);
  if(req.method==='OPTIONS') return res.status(204).end();
  if(req.method!=='POST') return sendJson(res,405,{ok:false,error:'Method not allowed. Use POST.'});
  try {
    if(!process.env.DEEPSEEK_API_KEY) return sendJson(res,500,{ok:false,error:'DEEPSEEK_API_KEY is not configured.'});
    if(!process.env.RESEARCH_API_TOKEN) return sendJson(res,500,{ok:false,error:'RESEARCH_API_TOKEN is not configured.'});
    if(req.headers?.['x-research-token']!==process.env.RESEARCH_API_TOKEN) return sendJson(res,401,{ok:false,error:'Unauthorized.'});
    const body=parseBody(req);
    const date=typeof body.date==='string'&&body.date.trim()?body.date.trim():new Date().toISOString().slice(0,10);
    const scope=normalizeScope(body.scope);
    const focus=typeof body.focus==='string'&&body.focus.trim()?body.focus.trim():(scope==='japan'?'Japan-process-level changes in monetary policy, wages, demographics, industry, energy, security and capital':scope==='china'?'China-process-level changes in property, local finance, manufacturing, technology, domestic demand, trade and capital':scope==='us'?'US-process-level changes in fiscal policy, rates, labor, industrial capacity, AI infrastructure, energy and capital':'world-process-level changes in technology, energy, macroeconomics, geopolitics, and capital');
    const existingProcesses=Array.isArray(body.existingProcesses)&&body.existingProcesses.length?body.existingProcesses:processCatalogForScope(scope);
    const requested=Number(body.maxSignals);
    const maxSignals=Number.isFinite(requested)?Math.min(6,Math.max(1,Math.trunc(requested))):3;
    const result=await callDeepSeek({date,focus,existingProcesses,maxSignals,scope});
    const parsed=result.data;
    const candidates=Array.isArray(parsed.candidates)?parsed.candidates.slice(0,maxSignals):[];
    if(!candidates.length) throw new Error('DeepSeek returned no candidate signals.');
    return sendJson(res,200,{
      ok:true,id:`research-${scope}-${date}-${Date.now()}`,status:'draft',researchedAt:new Date().toISOString(),researchDate:date,scope,
      provider:'deepseek',model:result.model,usage:compactUsage(result.usage),querySummary:parsed.querySummary,
      candidates:candidates.map((candidate)=>({...candidate,suggestedProcessId:candidate.suggestedProcessId||undefined,sources:Array.isArray(candidate.sources)?candidate.sources.map((source)=>({...source,publishedAt:source.publishedAt||undefined})):[]})),
    });
  } catch(error) { console.error('Research API failed:',error); return sendJson(res,error?.status||500,{ok:false,error:error instanceof Error?error.message:'Unknown research error.'}); }
}
