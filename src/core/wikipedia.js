/**
 * Client-side Wikipedia REST API search.
 * No auth, no adapter — calls Wikipedia directly from the browser.
 * Extracted from viewer's api.js:105-134.
 */
export async function searchWikipedia(entityName) {
  const encoded = encodeURIComponent(entityName);
  const searchRes = await fetch(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${encoded}&limit=5&format=json&origin=*`);
  if (!searchRes.ok) throw new Error('Wikipedia search failed.');
  const [, titles, , urls] = await searchRes.json();

  if (!titles || titles.length === 0) return [];

  const results = await Promise.all(
    titles.slice(0, 5).map(async (title, i) => {
      try {
        const summaryRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
        if (!summaryRes.ok) return { title, url: urls[i], summary: '', categories: [] };
        const data = await summaryRes.json();
        return {
          title: data.title || title,
          summary: data.extract || '',
          url: data.content_urls?.desktop?.page || urls[i],
          categories: [],
          description: data.description || '',
        };
      } catch {
        return { title, url: urls[i], summary: '', categories: [] };
      }
    })
  );

  return results;
}
