import globalCatalog from '../data/world-process-catalog.json' with { type: 'json' };
import japanCatalog from '../data/japan-process-catalog.json' with { type: 'json' };
import chinaCatalog from '../data/china-process-catalog.json' with { type: 'json' };
import usCatalog from '../data/us-process-catalog.json' with { type: 'json' };

export const SUPPORTED_SCOPES = ['global', 'china', 'us', 'japan'];

export function normalizeScope(value) {
  return SUPPORTED_SCOPES.includes(value) ? value : 'global';
}

export function scopeLabel(scope) {
  const normalized = normalizeScope(scope);
  if (normalized === 'china') return 'China';
  if (normalized === 'us') return 'United States';
  if (normalized === 'japan') return 'Japan';
  return 'Global';
}

export function processCatalogForScope(scope) {
  const normalized = normalizeScope(scope);
  if (normalized === 'china') return chinaCatalog;
  if (normalized === 'us') return usCatalog;
  if (normalized === 'japan') return japanCatalog;
  return globalCatalog;
}

export function findProcessAcrossScopes(processId) {
  if (!processId) return undefined;
  return [...globalCatalog, ...chinaCatalog, ...usCatalog, ...japanCatalog].find(
    (process) => process.id === processId,
  );
}
