const BLOCKED_HOSTS = new Set(['example.com', 'example.org', 'example.net', 'localhost']);

export function sourceHost(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!host || BLOCKED_HOSTS.has(host) || /\.(invalid|test|localhost)$/.test(host)) return '';
    return host;
  } catch {
    return '';
  }
}

export function auditCandidateSources(candidate, researchDate) {
  const seen = new Set();
  const origins = new Set();
  const validSources = [];
  for (const source of candidate?.sources || []) {
    const host = sourceHost(source?.url);
    if (!host || source?.kind === 'context') continue;
    const identity = String(source.publisher || host).trim().toLowerCase();
    const origin = String(source.evidenceOrigin || '').trim().toLowerCase();
    if (!origin) continue;
    if (seen.has(identity) || seen.has(host)) continue;
    const published = source.publishedAt ? Date.parse(source.publishedAt) : NaN;
    const research = Date.parse(researchDate);
    if (!Number.isNaN(published) && !Number.isNaN(research)) {
      const ageDays = Math.abs(research - published) / 86_400_000;
      if (ageDays > 45) continue;
    }
    seen.add(identity);
    seen.add(host);
    origins.add(origin);
    validSources.push(source);
  }
  return {
    ok: validSources.length >= 2,
    validSources,
    independentSourceCount: validSources.length,
    distinctEvidenceOriginCount: origins.size,
  };
}

export function domainBucket(candidate) {
  const declared = String(candidate?.domain || '').trim().toLowerCase();
  const canonical = new Set([
    'macro-finance', 'industry-trade', 'energy-resources', 'health-science',
    'climate-environment', 'demographics-society', 'institutions-culture',
    'urban-infrastructure', 'technology-ai', 'geopolitics-security',
  ]);
  if (canonical.has(declared)) return declared;
  const text = [candidate?.domain, ...(candidate?.tags || []), candidate?.content?.en?.title]
    .join(' ').toLowerCase();
  const buckets = [
    ['health-science', /health|medicine|disease|science|biotech|pharma/],
    ['climate-environment', /climate|weather|environment|water|agriculture|food/],
    ['demographics-society', /demograph|population|migration|labor|education|housing|society/],
    ['urban-infrastructure', /city|urban|infrastructure|transport|construction|building/],
    ['industry-trade', /industry|manufactur|supply chain|trade|shipping|logistics/],
    ['energy-resources', /energy|oil|gas|power|electric|mineral|commodity/],
    ['macro-finance', /macro|econom|inflation|rate|finance|capital|currency|debt/],
    ['technology-ai', /\bai\b|artificial intelligence|technology|semiconductor|software|robot/],
    ['geopolitics-security', /war|military|attack|security|geopolit|sanction|conflict/],
  ];
  return buckets.find(([, pattern]) => pattern.test(text))?.[0] || 'institutions-culture';
}

export function selectDiverseQualifiedCandidates(candidates, researchDate, limit = 6) {
  const qualified = (candidates || []).flatMap((candidate) => {
    const audit = auditCandidateSources(candidate, researchDate);
    if (!audit.ok) return [];
    return [{
      ...candidate,
      independentSourceCount: audit.independentSourceCount,
      sources: candidate.sources,
      qualityAudit: {
        verifiedSourceUrls: audit.independentSourceCount,
        distinctEvidenceOrigins: audit.distinctEvidenceOriginCount,
      },
    }];
  });
  const score = (candidate) => {
    const material = Math.max(
      Number(candidate.thesisImpact || 0),
      Number(candidate.relationshipChange || 0),
      Number(candidate.stageChange || 0),
      Number(candidate.contradiction || 0),
    );
    return Number(candidate.evidenceStrength || 0) * 0.32 +
      Number(candidate.novelty || 0) * 0.24 +
      Number(candidate.importance || 0) * 0.24 + material * 0.20;
  };
  qualified.sort((a, b) => score(b) - score(a));
  const result = [];
  const bucketCounts = new Map();
  // First pass protects one evidence-backed lead from every domain. The
  // second pass fills remaining slots by merit; this is parallel coverage,
  // not a rotating editorial quota.
  for (const candidate of qualified) {
    const bucket = domainBucket(candidate);
    if (bucketCounts.has(bucket)) continue;
    result.push(candidate);
    bucketCounts.set(bucket, 1);
    if (result.length >= limit) break;
  }
  if (result.length < limit) {
    for (const candidate of qualified) {
      if (result.includes(candidate)) continue;
      const bucket = domainBucket(candidate);
      const cap = ['technology-ai', 'geopolitics-security'].includes(bucket) ? 1 : 2;
      if ((bucketCounts.get(bucket) || 0) >= cap) continue;
      result.push(candidate);
      bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1);
      if (result.length >= limit) break;
    }
  }
  return result;
}
