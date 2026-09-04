/**
 * GraphAPIAdapter interface definition (JSDoc).
 *
 * All adapter methods return Promises. The adapter abstracts the transport layer —
 * fetchAdapter uses raw fetch (standalone viewer), sdkAdapter delegates to the JS SDK
 * (web app, studio).
 *
 * @typedef {Object} GraphAPIAdapter
 *
 * @property {function(number=): Promise<Object>} getFullGraph
 *   Fetch the full graph. Returns raw API response (normalized by useGraphData).
 *
 * @property {function(string[]): Promise<Object>} getEdgesBulk
 *   Fetch edges for multiple node IDs.
 *
 * @property {function(string): Promise<Object>} getGroundingStatus
 *   Get Wikipedia grounding status for a node.
 *
 * @property {function(string, Object): Promise<Object>} updateEntityNode
 *   Update entity node label/type. Triggers ontology self-learning on the backend.
 *
 * @property {function(string): Promise<void>} removeGrounding
 *   Remove Wikipedia grounding from a node.
 *
 * @property {function(string, string, number=): Promise<Object>} createOntologyPattern
 *   Create an ontology pattern (name, entity_type, confidence).
 *
 * @property {function(string, string): Promise<void>} deleteOntologyPattern
 *   Delete an ontology pattern by name and entity_type.
 *
 * @property {function(string, number=): Promise<Object>} getTemporalSnapshot
 *   Fetch a temporal snapshot of the graph at a given timestamp.
 *
 * @property {function(string, number=): Promise<Object>} searchMemories
 *   Hybrid search for memories.
 *
 * @property {function(string, {limit?: number, reasoning?: boolean}=): Promise<AskResponse>} ask
 *   Grounded question answering (DIST-LITE-9). POSTs /memory/ask. Served identically by
 *   the lite daemon and the hosted API. Rejects rather than returning a fallback answer
 *   when the server's LLM cannot answer.
 *
 * @typedef {Object} AskResponse
 * @property {string} answer - One or two sentences answering the question.
 * @property {string} reasoning - Reasoning citing the evidence; may be an empty string.
 * @property {Array<{item_id: string, content: string}>} evidence
 *   The retrieved memories, captured before the model ran.
 * @property {Array<{source: string, type: string, target: string, source_id: string, target_id: string}>} relations
 *   One-hop entity relations. `source_id`/`target_id` make each row addressable:
 *   `${source_id}->${target_id}:${type}` is the edge id normalizeAPIResponse builds.
 *
 * @property {function(string): Promise<Object>} getMemory
 *   Fetch a single memory by ID.
 *
 * @property {function(string): Promise<Object>} getLinks
 *   Fetch links for a memory.
 *
 * @property {function(string): Promise<Object>} getNeighbors
 *   Fetch neighbors of a node.
 *
 * @property {function(string, string, number=): Promise<Object>} findPath
 *   Find shortest path between two nodes.
 *
 * @property {function(number=, number=): Promise<Object>} listMemories
 *   List memories with pagination.
 *
 * @property {function(): string|null} getAuthToken
 *   Get the current auth token (for WS auth).
 *
 * @property {function(string): Promise<void>} deleteNode
 *   Delete a memory node and its graph data by item_id.
 *
 * @property {function(string): Promise<void>} deleteEntityNode
 *   Delete an entity graph node and all its edges from FalkorDB by node_id.
 */

export {};
