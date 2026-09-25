/**
 * Fetch-based adapter for the SmartMemory Graph API.
 * Used by the standalone viewer — wraps raw fetch with auth headers.
 *
 * @param {Object} config
 * @param {string} config.apiUrl - Base API URL (e.g., 'http://localhost:9001')
 * @param {function(): string|null} config.getToken - Returns current JWT token
 * @param {function(): string|null} config.getTeamId - Returns current team ID
 * @param {typeof fetch} [config.fetchFn] - Inject an SDK auth fetch for hosted session recovery
 * @returns {GraphAPIAdapter}
 */
/** Read a cookie value by name (browser-only, non-httpOnly). */
function getCookie(name) {
  const match = document.cookie.split('; ').find(c => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=')[1]) : null;
}

export function createFetchAdapter({ apiUrl, getToken, getTeamId, fetchFn = globalThis.fetch.bind(globalThis) }) {
  async function request(method, path, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    // Prefer explicit getTeamId(), fall back to sm_team_id cookie set by /auth/clerk/session
    const team = getTeamId() || getCookie('sm_team_id');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (team) headers['X-Workspace-Id'] = team;
    const opts = { method, headers, credentials: 'include' };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetchFn(`${apiUrl}${path}`, opts);
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
    return res.status === 204 ? null : res.json();
  }

  return {
    // No client-side default cap; backend applies the authoritative limit.
    getFullGraph: (limit) => request('GET', limit == null ? '/memory/graph/full' : `/memory/graph/full?limit=${encodeURIComponent(limit)}`),
    getEdgesBulk: (nodeIds) => request('POST', '/memory/graph/edges', { node_ids: nodeIds }),
    getGroundingStatus: (id) => request('GET', `/memory/graph/nodes/${encodeURIComponent(id)}/grounding`),
    updateEntityNode: (id, updates) => request('PATCH', `/memory/graph/nodes/${encodeURIComponent(id)}`, updates),
    removeGrounding: (id) => request('DELETE', `/memory/graph/nodes/${encodeURIComponent(id)}/grounding`),
    createOntologyPattern: (name, type, confidence) => request('POST', '/memory/ontology/patterns', { name, entity_type: type, confidence }),
    deleteOntologyPattern: (name, type) => request('DELETE', `/memory/ontology/patterns/${encodeURIComponent(name)}?entity_type=${encodeURIComponent(type)}`),
    getTemporalSnapshot: (ts, limit = 2000) => request('GET', `/memory/temporal/at/${encodeURIComponent(ts)}?limit=${limit}`),
    searchMemories: (query, topK = 20) => request('POST', '/memory/search', { query, top_k: topK, enable_hybrid: true }),
    // DIST-LITE-9 — grounded question answering. The lite daemon (:9014) and the hosted
    // API serve the identical body, so AskPanel works against either through this method.
    ask: (question, { limit = 5, reasoning = true } = {}) => {
      const body = { question, limit };
      if (reasoning !== true) body.reasoning = reasoning;
      return request('POST', '/memory/ask', body);
    },
    getMemory: (id) => request('GET', `/memory/${encodeURIComponent(id)}`),
    getLinks: (id) => request('GET', `/memory/${encodeURIComponent(id)}/links`),
    getNeighbors: (id) => request('GET', `/memory/${encodeURIComponent(id)}/neighbors`),
    findPath: (startId, endId, maxHops = 5) => request('GET', `/memory/graph/path?start_id=${encodeURIComponent(startId)}&end_id=${encodeURIComponent(endId)}&max_hops=${maxHops}`),
    listMemories: (limit = 2000, offset = 0) => request('GET', `/memory/list?limit=${limit}&offset=${offset}`),
    deleteNode: (id) => request('DELETE', `/memory/${encodeURIComponent(id)}`),
    deleteEntityNode: (id) => request('DELETE', `/memory/graph/nodes/${encodeURIComponent(id)}`),
    // Decision endpoints — see contracts/decisions.json
    listActiveDecisions: ({ domain, decisionType, minConfidence, limit } = {}) => {
      const qs = new URLSearchParams();
      if (domain) qs.set('domain', domain);
      if (decisionType) qs.set('decision_type', decisionType);
      if (minConfidence != null) qs.set('min_confidence', String(minConfidence));
      if (limit != null) qs.set('limit', String(limit));
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return request('GET', `/memory/decisions${suffix}`);
    },
    getDecision: (id) => request('GET', `/memory/decisions/${encodeURIComponent(id)}`),
    getDecisionProvenance: (id) => request('GET', `/memory/decisions/${encodeURIComponent(id)}/provenance`),
    getDecisionCausalChain: (id, { direction = 'both', maxDepth = 3 } = {}) =>
      request('GET', `/memory/decisions/${encodeURIComponent(id)}/causal-chain?direction=${encodeURIComponent(direction)}&max_depth=${maxDepth}`),
    findDecisionConflicts: (id) => request('POST', `/memory/decisions/${encodeURIComponent(id)}/conflicts`),
    getAuthToken: () => getToken(),
  };
}
