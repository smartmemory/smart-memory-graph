/**
 * SDK-based adapter for the SmartMemory Graph API.
 * Delegates to the JS SDK's typed API classes, which handle auth, team headers,
 * token refresh, and base URL transparently.
 *
 * @param {import('@smartmemory/sdk-js').SmartMemoryClient} client - SDK client instance
 * @returns {import('./types').GraphAPIAdapter}
 */
export function createSDKAdapter(client) {
  return {
    getFullGraph: (limit) =>
      client.graph.getFullGraph(limit),

    getEdgesBulk: (nodeIds) =>
      client.graph.getEdgesBulk(nodeIds),

    getGroundingStatus: (id) =>
      client.graph.getGroundingStatus(id),

    updateEntityNode: (id, updates) =>
      client.graph.updateEntityNode(id, updates),

    removeGrounding: (id) =>
      client.graph.removeGrounding(id),

    createOntologyPattern: (name, type, confidence = 1.0) =>
      client.ontology.createPattern({ name, entityType: type, confidence }),

    deleteOntologyPattern: (name, type) =>
      client.ontology.deletePattern(name, type),

    getTemporalSnapshot: (ts, limit = 2000) =>
      client.temporal.timeTravel(ts, { limit }),

    searchMemories: (query, topK = 20) =>
      client.memories.search(query, { topK, enableHybrid: true }),

    // DIST-LITE-9. Falls back to the underlying HTTP client when the installed SDK
    // predates `memories.ask` — the same pattern the decision methods below use.
    ask: (question, { limit = 5, reasoning = true } = {}) => {
      if (client.memories?.ask) return client.memories.ask(question, { limit, reasoning });
      const body = { question, limit };
      if (reasoning !== true) body.reasoning = reasoning;
      return (client.http || client._http || client).post?.('/memory/ask', body);
    },

    getMemory: (id) =>
      client.memories.get(id),

    getLinks: (id) =>
      client.graph.getLinks(id),

    getNeighbors: (id) =>
      client.graph.getNeighbors(id),

    findPath: (startId, endId, maxHops = 5) =>
      client.graph.findShortestPath(startId, endId, maxHops),

    listMemories: (limit = 2000, offset = 0) =>
      client.memories.list({ limit, offset }),

    deleteNode: (id) =>
      client.memories.delete(id),

    deleteEntityNode: (id) =>
      client.graph.deleteEntityNode(id),

    // Decision endpoints — see contracts/decisions.json. The SDK may not expose
    // these yet; the adapter falls back to the underlying HTTP client when a
    // dedicated `client.decisions.*` method is missing.
    listActiveDecisions: (params = {}) =>
      client.decisions?.list
        ? client.decisions.list(params)
        : (client.http || client._http || client).get?.('/memory/decisions', { params }),
    getDecision: (id) =>
      client.decisions?.get
        ? client.decisions.get(id)
        : (client.http || client._http || client).get?.(`/memory/decisions/${encodeURIComponent(id)}`),
    getDecisionProvenance: (id) =>
      client.decisions?.getProvenance
        ? client.decisions.getProvenance(id)
        : (client.http || client._http || client).get?.(`/memory/decisions/${encodeURIComponent(id)}/provenance`),
    getDecisionCausalChain: (id, opts = {}) =>
      client.decisions?.getCausalChain
        ? client.decisions.getCausalChain(id, opts)
        : (client.http || client._http || client).get?.(`/memory/decisions/${encodeURIComponent(id)}/causal-chain`, { params: opts }),
    findDecisionConflicts: (id) =>
      client.decisions?.findConflicts
        ? client.decisions.findConflicts(id)
        : (client.http || client._http || client).post?.(`/memory/decisions/${encodeURIComponent(id)}/conflicts`),

    getAuthToken: () =>
      client.auth.tokenManager.getAccessToken(),
  };
}
