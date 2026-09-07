const ENDPOINT = 'https://api.gdeltproject.org/api/v2/doc/doc';

const SEARCHES = [
  ['macro-finance', '(economy OR inflation OR central bank OR debt OR currency)'],
  ['industry-trade', '(manufacturing OR trade OR shipping OR supply chain OR housing)'],
  ['energy-resources', '(energy OR electricity OR oil OR gas OR mineral OR agriculture)'],
  ['health-science', '(health OR medicine OR disease OR science OR biotech)'],
  ['climate-environment', '(climate OR weather OR water OR environment OR food)'],
  ['demographics-society', '(population OR migration OR labor OR education OR inequality)'],
  ['institutions-culture', '(regulation OR court OR election OR institution OR culture)'],
  ['technology-ai', '(technology OR semiconductor OR robotics OR artificial intelligence)'],
];

function gdeltTimestamp(timestamp) {
  return new Date(timestamp).toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

export function gdeltWindow(date, now = Date.now()) {
  const targetStart = Date.parse(`${date}T00:00:00+09:00`);
  if (Number.isNaN(targetStart)) throw new Error(`Invalid research date: ${date}.`);
  const targetEnd = targetStart + 86_400_000 - 1_000;
  const end = Math.min(now, targetEnd);
  const start = end - 36 * 60 * 60 * 1_000;
  return {
    startdatetime: gdeltTimestamp(start),
    enddatetime: gdeltTimestamp(end),
  };
}

function isoDate(value, fallback) {
  const match = String(value || '').match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?/);
  if (!match) return `${fallback}T00:00:00.000Z`;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4] || '00'}:${match[5] || '00'}:${match[6] || '00'}.000Z`;
}

async function fetchGroup([bucket, query], date) {
  const window = gdeltWindow(date);
  const url = new URL(ENDPOINT);
  url.searchParams.set('query', `${query} sourcelang:english`);
  url.searchParams.set('mode', 'ArtList');
  url.searchParams.set('maxrecords', '15');
  url.searchParams.set('format', 'json');
  url.searchParams.set('sort', 'HybridRel');
  url.searchParams.set('startdatetime', window.startdatetime);
  url.searchParams.set('enddatetime', window.enddatetime);
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`GDELT ${bucket} failed (${response.status}).`);
  const payload = await response.json();
  return (payload.articles || []).flatMap((article) => {
    if (!article?.url || !article?.title || !article?.domain) return [];
    return [{
      bucket,
      title: article.title,
      url: article.url,
      publisher: article.domain,
      publishedAt: isoDate(article.seendate, date),
      sourceCountry: article.sourcecountry || undefined,
      language: article.language || 'English',
    }];
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function collectGdeltDossier(date) {
  const seen = new Set();
  const articles = [];
  const failures = [];
  for (const [index, search] of SEARCHES.entries()) {
    try {
      const records = await fetchGroup(search, date);
      for (const article of records) {
        if (seen.has(article.url)) continue;
        seen.add(article.url);
        articles.push(article);
      }
    } catch (error) {
      failures.push(`${search[0]}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (index < SEARCHES.length - 1) await delay(4_000);
  }
  if (articles.length < 12) {
    const detail = failures.length ? ` Failures: ${failures.join(' | ')}` : '';
    throw new Error(
      `Independent news index returned only ${articles.length} usable records.${detail}`,
    );
  }
  return {
    provider: 'GDELT 2.1 DOC API',
    date,
    coverage: Object.fromEntries(SEARCHES.map(([bucket]) => [
      bucket,
      articles.filter((item) => item.bucket === bucket).length,
    ])),
    articles: articles.slice(0, 100),
  };
}
