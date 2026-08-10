import { normalizeScope, processCatalogForScope, scopeLabel } from '../lib/processScopes.mjs';
import { analyzeDraft } from '../lib/analyst.mjs';
import { compactUsage, deepseekConfig, deepseekToolJSON } from '../lib/deepseekClient.mjs';

const analysisSchema = {"type": "object", "additionalProperties": false, "required": ["analyses"], "properties": {"analyses": {"type": "array", "minItems": 1, "items": {"type": "object", "additionalProperties": false, "required": ["candidateId", "matchedProcessId", "processMatchConfidence", "impact", "dailyState", "materialChangeScore", "publishThresholdMet", "rationale", "warnings"], "properties": {"candidateId": {"type": "string"}, "matchedProcessId": {"type": ["string", "null"]}, "processMatchConfidence": {"type": "integer", "minimum": 0, "maximum": 100}, "impact": {"type": "string", "enum": ["supports", "updates", "challenges", "no_material_change"]}, "dailyState": {"type": "string", "enum": ["publish_new", "update_living", "no_new_global_insight"]}, "materialChangeScore": {"type": "integer", "minimum": 0, "maximum": 100}, "publishThresholdMet": {"type": "boolean"}, "rationale": {"type": "string"}, "warnings": {"type": "array", "items": {"type": "string"}, "maxItems": 8}}}}}};
function setCors(res) { res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type, x-research-token'); }
function json(res,status,value) { setCors(res); return res.status(status).json(value); }
function parseBody(req) { if(!req.body) return {}; if(typeof req.body==='object') return req.body; try { return JSON.parse(req.body); } catch { const e=new Error('Request body must be valid JSON.'); e.status=400; throw e; } }

export default async function handler(req,res) {
 setCors(res); if(req.method==='OPTIONS') return res.status(204).end(); if(req.method!=='POST') return json(res,405,{ok:false,error:'Method not allowed. Use POST.'});
 try {
  if(!process.env.DEEPSEEK_API_KEY) return json(res,500,{ok:false,error:'DEEPSEEK_API_KEY is not configured.'});
  if(!process.env.RESEARCH_API_TOKEN) return json(res,500,{ok:false,error:'RESEARCH_API_TOKEN is not configured.'});
  if(req.headers?.['x-research-token']!==process.env.RESEARCH_API_TOKEN) return json(res,401,{ok:false,error:'Unauthorized.'});
  const body=parseBody(req); const draft=body.draft||body;
  if(!draft?.researchDate||!Array.isArray(draft?.candidates)) return json(res,400,{ok:false,error:'A research draft with researchDate and candidates is required.'});
  const scope=normalizeScope(body.scope||draft.scope);
  const scopeName=scopeLabel(scope);
  const processes=Array.isArray(body.existingProcesses)&&body.existingProcesses.length?body.existingProcesses:processCatalogForScope(scope);
  const normalized=analyzeDraft(draft,processes);
  const config=deepseekConfig();
  const system=[
   `You are the AI Analyst for Insight. Evaluate candidate signals as ${scopeName} Process changes.`,
   `Use only the supplied candidates, sources, and ${scopeName} Process catalogue.`,
   scope==='japan'
     ? 'Judge significance from the perspective of Japan. A globally important event is not enough unless it changes a Japan-specific system.'
     : scope==='china'
       ? 'Judge significance from the perspective of China. A globally important event is not enough unless it changes a China-specific system.'
       : scope==='us'
         ? 'Judge significance from the perspective of the United States. A globally important event is not enough unless it changes a US-specific system.'
         : 'Judge significance at the global system level.',
   'Do not invent facts. Be conservative when sources are weak or not independent.',
   'publish_new requires high novelty and a genuinely new system relationship.',
   'update_living requires a material update to an existing process.',
   'Otherwise choose no_new_global_insight. This enum is retained for schema compatibility; interpret it as no new Insight within the active scope. Return the required tool JSON.'
  ].join(' ');
  const user=JSON.stringify({researchDate:draft.researchDate,scope,candidates:normalized.candidates,processes:processes.map(p=>({id:p.id,title:p.title,thesis:p.thesis,currentStage:p.currentStage,domains:p.domains,tags:p.tags}))});
  const result=await deepseekToolJSON({model:config.analyzeModel,system,user,toolName:'submit_insight_analysis',schema:analysisSchema,reasoningEffort:'max',maxTokens:18000});
  const byId=new Map((result.data.analyses||[]).map(item=>[item.candidateId,item]));
  const candidates=normalized.candidates.map(candidate=>{
    const ai=byId.get(candidate.id); if(!ai) return candidate;
    const matched=ai.matchedProcessId&&processes.some(p=>p.id===ai.matchedProcessId)?ai.matchedProcessId:undefined;
    return {...candidate,suggestedProcessId:matched||candidate.suggestedProcessId,processMatchConfidence:ai.processMatchConfidence,analysis:{...candidate.analysis,...ai,matchedProcessId:matched,warnings:[...(candidate.analysis?.warnings||[]),...(ai.warnings||[])]}};
  });
  return json(res,200,{ok:true,analyzedAt:new Date().toISOString(),provider:'deepseek',model:result.model,usage:compactUsage(result.usage),draft:{...normalized,scope,model:result.model,analysisProvider:'deepseek',candidates}});
 } catch(error) { console.error('Analyze API failed:',error); return json(res,error?.status||500,{ok:false,error:error instanceof Error?error.message:'Unknown analysis error.'}); }
}
