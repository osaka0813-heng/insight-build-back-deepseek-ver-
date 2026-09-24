const ENDPOINT = 'https://api.gdeltproject.org/api/v2/doc/doc';

const SEARCHES = [
  ['macro-finance', '(economy OR inflation OR "central bank" OR debt OR currency)'],
  ['industry-trade', '(manufacturing OR trade OR shipping OR "supply chain" OR housing)'],
  ['energy-resources', '(energy OR electricity OR oil OR gas OR mineral OR agriculture)'],
  ['health-science', '(health OR medicine OR disease OR science OR biotech)'],
  ['climate-environment', '(climate OR weather OR water OR environment OR food)'],
  ['demographics-society', '(population OR migration OR labor OR education OR inequality)'],
  ['institutions-culture', '(regulation OR court OR election OR institution OR culture)'],
  ['urban-infrastructure', '(city OR urban OR infrastructure OR transport OR construction)'],
  ['technology-ai', '(technology OR semiconductor OR robotics OR "artificial intelligence")'],
  ['geopolitics-security', '(diplomacy OR sanction OR defense OR conflict OR security)'],
];

const FEEDS = [
  ['macro-finance', 'https://feeds.bbci.co.uk/news/business/rss.xml'],
  ['health-science', 'https://feeds.bbci.co.uk/news/health/rss.xml'],
  ['climate-environment', 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml'],
  ['institutions-culture', 'https://feeds.bbci.co.uk/news/world/rss.xml'],
  ['industry-trade', 'https://www.theguardian.com/business/rss'],
  ['health-science', 'https://www.theguardian.com/science/rss'],
  ['climate-environment', 'https://www.theguardian.com/environment/rss'],
  ['demographics-society', 'https://www.theguardian.com/society/rss'],
  ['technology-ai', 'https://feeds.bbci.co.uk/news/technology/rss.xml'],
];

const TITLE_STOP_WORDS = new Set([
  'about', 'after', 'amid', 'from', 'into', 'over', 'says', 'that', 'their',
  'this', 'through', 'under', 'with', 'world', 'news', 'report', 'reports',
]);

function titleTerms(title) {
  return new Set(String(title || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length >= 4 && !TITLE_STOP_WORDS.has(term)));
}

// GDELT and RSS describe the same event with different wording. Surface likely
// cross-publisher matches before the model runs so it does not have to discover
// corroboration from an unstructured list of up to 100 headlines.
export function buildCorroboratedPairs(articles, limit = 24) {
  const pairs = [];
  for (let left = 0; left < articles.length; left += 1) {
    const a = articles[left];
    const aTerms = titleTerms(a.title);
    if (aTerms.size < 2) continue;
    for (let right = left + 1; right < articles.length; right += 1) {
      const b = articles[right];
      if (!a?.url || !b?.url || a.url === b.url) continue;
      if (String(a.publisher || '').toLowerCase() === String(b.publisher || '').toLowerCase()) continue;
      const bTerms = titleTerms(b.title);
      const sharedTerms = [...aTerms].filter((term) => bTerms.has(term));
      const score = sharedTerms.length / Math.max(1, Math.min(aTerms.size, bTerms.size));
      if (sharedTerms.length < 2 || score < 0.34) continue;
      pairs.push({
        bucket: a.bucket === b.bucket ? a.bucket : `${a.bucket}+${b.bucket}`,
        sharedTerms,
        similarity: Number(score.toFixed(3)),
        sources: [a, b],
      });
    }
  }
  return pairs.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
}

function xmlText(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, '').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
}

// RSS is a current-news backup, never a license to relabel today's news as
// historical content. Items outside the requested window are discarded.
export function parseFeed(xml, bucket, date, now = Date.now()) {
  const end = Math.min(now, Date.parse(`${date}T23:59:59+09:00`));
  const start = end - 36 * 60 * 60 * 1000;
  return [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].flatMap(([, item]) => {
    const field = (name) => xmlText(item.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1] || '');
    const title = field('title');
    const url = field('link');
    const published = Date.parse(field('pubDate'));
    if (!title || !/^https?:\/\//i.test(url) || !Number.isFinite(published) || published < start || published > end) return [];
    try {
      return [{ bucket, title, url, publisher: new URL(url).hostname.replace(/^www\./, ''), publishedAt: new Date(published).toISOString(), language: 'English', provider: 'publisher-rss' }];
    } catch { return []; }
  }).slice(0, 15);
}

async function collectFeeds(date, failures, fetcher) {
  return (await Promise.all(FEEDS.map(async ([bucket, url]) => {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return parseFeed(await response.text(), bucket, date);
    } catch (error) {
      failures.push(`RSS ${bucket}: ${error.message}`);
      return [];
    }
  }))).flat();
}

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

async function fetchGroup([bucket, query], date, signal, fetcher) {
  const window = gdeltWindow(date);
  const url = new URL(ENDPOINT);
  url.searchParams.set('query', `${query} sourcelang:english`);
  url.searchParams.set('mode', 'ArtList');
  url.searchParams.set('maxrecords', '15');
  url.searchParams.set('format', 'json');
  url.searchParams.set('sort', 'HybridRel');
  url.searchParams.set('startdatetime', window.startdatetime);
  url.searchParams.set('enddatetime', window.enddatetime);
  const response = await fetcher(url, { signal });
  if (!response.ok) throw new Error(`GDELT ${bucket} failed (${response.status}).`);
  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); }
  catch { throw new Error(`GDELT ${bucket} returned non-JSON: ${raw.slice(0, 160)}`); }
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

export async function collectGdeltDossier(date, { fetcher = fetch, wait = delay, budgetMs = 55_000 } = {}) {
  const seen = new Set();
  const articles = [];
  const failures = [];
  const rssPromise = collectFeeds(date, failures, fetcher);
  const deadline = Date.now() + budgetMs;
  for (const [index, search] of SEARCHES.entries()) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) { failures.push('GDELT collection time budget reached'); break; }
    try {
      const records = await fetchGroup(search, date, AbortSignal.timeout(Math.max(1, Math.min(8_000, remaining))), fetcher);
      for (const article of records) {
        if (seen.has(article.url)) continue;
        seen.add(article.url);
        articles.push(article);
      }
    } catch (error) {
      failures.push(`${search[0]}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (index < SEARCHES.length - 1) await wait(Math.max(0, Math.min(4_000, deadline - Date.now())));
  }
  for (const article of await rssPromise) {
    if (!seen.has(article.url)) { seen.add(article.url); articles.push(article); }
  }
  if (articles.length < 12) {
    const detail = failures.length ? ` Failures: ${failures.join(' | ')}` : '';
    throw new Error(
      `Independent news index returned only ${articles.length} usable records.${detail}`,
    );
  }
  return {
    provider: 'GDELT DOC API + publisher RSS',
    failures,
    date,
    coverage: Object.fromEntries(SEARCHES.map(([bucket]) => [
      bucket,
      articles.filter((item) => item.bucket === bucket).length,
    ])),
    corroboratedPairs: buildCorroboratedPairs(articles),
    articles: articles.slice(0, 100),
  };
}
