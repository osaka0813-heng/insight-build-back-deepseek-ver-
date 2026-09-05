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
    if (!origin || origins.has(origin)) continue;
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
  };
}

export function domainBucket(candidate) {
  const text = [candidate?.domain, ...(candidate?.tags || []), candidate?.content?.en?.title]
    .join(' ').toLowerCase();
  const buckets = [
    ['health-science', /health|medicine|disease|science|biotech|pharma/],
    ['climate-environment', /climate|weather|environment|water|agriculture|food/],
    ['demographics-society', /demograph|population|migration|labor|education|housing|society/],
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
        distinctEvidenceOrigins: audit.independentSourceCount,
      },
    }];
  });
  const result = [];
  const bucketCounts = new Map();
  for (const candidate of qualified) {
    const bucket = domainBucket(candidate);
    const cap = ['technology-ai', 'geopolitics-security'].includes(bucket) ? 1 : 2;
    if ((bucketCounts.get(bucket) || 0) >= cap) continue;
    result.push(candidate);
    bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1);
    if (result.length >= limit) break;
  }
  return result;
}
