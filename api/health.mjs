import { deepseekConfig } from '../lib/deepseekClient.mjs';
export default async function handler(req,res) {
 res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
 if(req.method==='OPTIONS') return res.status(204).end();
 if(req.method!=='GET') return res.status(405).json({ok:false,error:'Method not allowed. Use GET.'});
 const config=deepseekConfig();
 return res.status(200).json({ok:true,service:'insight-deepseek-backend',version:'012.6-alpha-full-deepseek',provider:'deepseek',models:{research:config.researchModel,analyze:config.analyzeModel,write:config.writeModel},configured:Boolean(config.apiKey),checkedAt:new Date().toISOString()});
}
