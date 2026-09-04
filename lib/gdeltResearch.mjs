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

function gdeltDate(date, end = false) {
  return `${date.replaceAll('-', '')}${end ? '235959' : '000000'}`;
}

function isoDate(value, fallback) {
  const match = String(value || '').match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?/);
  if (!match) return `${fallback}T00:00:00.000Z`;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4] || '00'}:${match[5] || '00'}:${match[6] || '00'}.000Z`;
}

async function fetchGroup([bucket, query], date) {
  const url = new URL(ENDPOINT);
  url.searchParams.set('query', `${query} sourcelang:english`);
  url.searchParams.set('mode', 'ArtList');
  url.searchParams.set('maxrecords', '15');
  url.searchParams.set('format', 'json');
  url.searchParams.set('sort', 'HybridRel');
  url.searchParams.set('startdatetime', gdeltDate(date));
  url.searchParams.set('enddatetime', gdeltDate(date, true));
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

export async function collectGdeltDossier(date) {
  const settled = await Promise.allSettled(SEARCHES.map((item) => fetchGroup(item, date)));
  const seen = new Set();
  const articles = [];
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    for (const article of result.value) {
      if (seen.has(article.url)) continue;
      seen.add(article.url);
      articles.push(article);
    }
  }
  if (articles.length < 12) {
    throw new Error(`Independent news index returned only ${articles.length} usable records.`);
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
