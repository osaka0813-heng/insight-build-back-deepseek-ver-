# Build013 Beta — Four-Scope Auto Publisher

Scopes:
- WORLD / GLOBAL
- CHINA
- US
- JAPAN

## One-click editorial automation
The editor now has one action that automatically runs, in order, for all four scopes:
Research -> Analyze -> staged Write (EN -> ZH -> JA -> finalize) -> Publish.

The user does not have to press each stage or each region manually.

For reliability, this is one-click from the user's perspective but internally remains
a sequence of short API requests. This avoids recreating the DeepSeek/Vercel timeout
problem caused by one oversized long-running request.

A Write failure is retried once for that scope. A failure in one scope does not prevent
the remaining scopes from running.

## Reader
The cover page now exposes:
WORLD / CHINA / US / JAPAN

Published Insights retain `scope`. Legacy Insights without a scope are treated as GLOBAL.
A region without published content stays unavailable until its first automatic publish.

## Process catalogs
China:
- Property and local-finance transition
- Industrial upgrading
- Technology autonomy
- Domestic-demand rebalancing

United States:
- Fiscal, rates and dollar regime
- AI capex and power buildout
- Reindustrialization
- Labor and immigration regime

Japan catalog from Alpha remains active.
