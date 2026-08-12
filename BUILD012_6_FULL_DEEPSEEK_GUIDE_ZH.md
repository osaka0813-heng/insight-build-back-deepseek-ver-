# Build012.6 Alpha — Full DeepSeek Pipeline

## 模型分工
- Research: `deepseek-v4-flash` + Responses API + server-side `web_search`
- Analyze: `deepseek-v4-pro` + Chat Completions strict function tool
- Write: `deepseek-v4-pro` + Chat Completions strict function tool

OpenAI 不再参与 Research / Analyze / Write。发布、GitHub 备份和恢复逻辑保持不变。

## Vercel 环境变量
新增：
```
DEEPSEEK_API_KEY
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_RESEARCH_MODEL=deepseek-v4-flash
DEEPSEEK_ANALYZE_MODEL=deepseek-v4-pro
DEEPSEEK_WRITE_MODEL=deepseek-v4-pro
```
保留：`RESEARCH_API_TOKEN`、`PUBLISH_API_TOKEN`、`ADMIN_CONSOLE_TOKEN`、全部 `GITHUB_*`。

旧的 `OPENAI_API_KEY` 和 `OPENAI_MODEL` 可以暂时留着，但本版本不会读取。

## 部署
把压缩包解压后的全部文件上传到后端仓库根目录，确认根目录直接看到 `api/`、`lib/`、`data/`、`package.json`、`vercel.json`。Vercel 部署 Ready 后先访问 `/api/health`，应显示 provider 为 `deepseek`。

## 测试
1. 清除编辑台旧流程草稿。
2. Research → Analyze → Write。
3. 确认三步显示的 model 都是 DeepSeek。
4. 确认第04页完整且没有“无字段”。
5. Preflight PASS 后发布。
