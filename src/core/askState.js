/**
 * Ask-panel state and selection payloads (DIST-LITE-9).
 *
 * Kept out of the component so the lifecycle (idle → loading → answered/error) and the
 * selection payloads can be tested against a fake adapter without a DOM. The component
 * is then a thin view over these; see AskPanel.jsx and AskResult.jsx.
 *
 * Contract: docs/features/DIST-LITE-9/ask-contract.json
 */

export const ASK_IDLE = 'idle';
export const ASK_LOADING = 'loading';
export const ASK_ANSWERED = 'answered';
export const ASK_ERROR = 'error';

export const INITIAL_ASK_STATE = {
  status: ASK_IDLE,
  question: '',
  result: null,
  error: null,
};

/**
 * Reducer for one ask at a time.
 *
 * A submit clears the previous answer rather than leaving it on screen under a spinner:
 * a stale answer next to a new question reads as an answer to the new one.
 */
export function askReducer(state, action) {
  switch (action.type) {
    case 'submit':
      return { status: ASK_LOADING, question: action.question, result: null, error: null };
    case 'resolve':
      // Ignore a reply that is not for the question currently in flight — a fast second
      // submit must not be overwritten by the slower first response.
      if (state.status !== ASK_LOADING || action.question !== state.question) return state;
      return { status: ASK_ANSWERED, question: state.question, result: action.result, error: null };
    case 'reject':
      if (state.status !== ASK_LOADING || action.question !== state.question) return state;
      return { status: ASK_ERROR, question: state.question, result: null, error: action.error };
    case 'reset':
      return INITIAL_ASK_STATE;
    default:
      return state;
  }
}

/**
 * Coerce a server reply into the contract shape.
 *
 * Missing arrays become empty ones so the view never crashes, but nothing is invented:
 * a response with no `answer` field yields an empty answer, which the view reports as a
 * failure rather than rendering as a blank success.
 *
 * Evidence and relation rows are BUILT from the contract's fields (ask-contract.json
 * `additionalProperties: false`), never passed through: a saved answer is replayed through
 * this (WEB-SEARCH-PERSIST-FU-1), and any field AskResult renders, keys on or interpolates
 * (`relationEdgeId`) that held an object such as `{"toString":null}` would throw. Each field
 * is text (a string or a finite number) or left out, and unknown fields are dropped.
 */
export function normalizeAskResponse(raw) {
  const body = isRecord(raw) ? raw : {};
  return {
    answer: typeof body.answer === 'string' ? body.answer : '',
    reasoning: typeof body.reasoning === 'string' ? body.reasoning : '',
    evidence: Array.isArray(body.evidence) ? body.evidence.map(buildEvidence).filter(Boolean) : [],
    relations: Array.isArray(body.relations) ? body.relations.map(buildRelation).filter(Boolean) : [],
  };
}

/** The fields of a built evidence row (contract `evidence.items`). */
export const EVIDENCE_FIELDS = ['item_id', 'content'];
/** The fields of a built relation row (contract `relations.items`). */
export const RELATION_FIELDS = ['source', 'type', 'target', 'source_id', 'target_id'];

function isRecord(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isText(v) {
  return typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
}

// Non-empty text: an id or a type, which addresses something and so cannot be blank.
function isKey(v) {
  return isText(v) && v !== '';
}

// An evidence row is addressed by item_id (list key, selection), so a row without one is
// dropped. Content AskResult renders as a child: text, or '' when it is not.
function buildEvidence(row) {
  if (!isRecord(row) || !isKey(row.item_id)) return null;
  return { item_id: row.item_id, content: isText(row.content) ? row.content : '' };
}

// A relation row needs a type (rendered, keyed, part of the edge id), else it is dropped.
// Labels are text or ''. Node ids are kept only when both are text: without them the row
// renders with its labels but is not selectable (relationEdgeId returns null).
function buildRelation(row) {
  if (!isRecord(row) || !isKey(row.type)) return null;
  const relation = {
    source: isText(row.source) ? row.source : '',
    type: row.type,
    target: isText(row.target) ? row.target : '',
  };
  if (isKey(row.source_id) && isKey(row.target_id)) {
    relation.source_id = row.source_id;
    relation.target_id = row.target_id;
  }
  return relation;
}

/**
 * A host-supplied saved answer (`AskPanel` `initialAnswer`), checked the way a live answer is:
 * the question must be a non-empty string, the result goes through normalizeAskResponse, and a
 * result with no answer text is no answer (the rule runAsk applies). Returns
 * `{question, result}` or null, in which case the panel starts empty.
 */
export function normalizeInitialAnswer(initialAnswer) {
  if (!isRecord(initialAnswer)) return null;
  const { question, result } = initialAnswer;
  if (typeof question !== 'string' || !question.trim() || !isRecord(result)) return null;
  const normalized = normalizeAskResponse(result);
  return normalized.answer ? { question, result: normalized } : null;
}

/**
 * The graph element id for a relation row.
 *
 * Matches the edge id `normalizeAPIResponse` builds (core/normalize.js) so a host can
 * hand this straight to Cytoscape's `getElementById`. Returns null when the server did
 * not send node ids — a label pair cannot address an element, and guessing one would
 * silently select the wrong edge.
 */
export function relationEdgeId(relation) {
  if (!relation || !relation.source_id || !relation.target_id || !relation.type) return null;
  return `${relation.source_id}->${relation.target_id}:${relation.type}`;
}

/** Selection payload for an evidence row: `[itemId, meta]`. */
export function evidenceSelection(item) {
  if (!item || !item.item_id) return null;
  return [item.item_id, { kind: 'evidence', item }];
}

/**
 * Selection payload for a relation row: `[edgeId, meta]`.
 *
 * `meta.sourceId` / `meta.targetId` are carried alongside because a host whose graph
 * view can only focus nodes still has something to focus.
 */
export function relationSelection(relation) {
  const edgeId = relationEdgeId(relation);
  if (!edgeId) return null;
  return [
    edgeId,
    {
      kind: 'relation',
      relation,
      sourceId: relation.source_id,
      targetId: relation.target_id,
    },
  ];
}

/**
 * Run one ask through an adapter and normalize the reply.
 *
 * Throws when the adapter has no `ask` method, rather than resolving to an empty answer:
 * an adapter built against an older package version must say so out loud.
 */
export async function runAsk(adapter, question, { limit } = {}) {
  if (!adapter || typeof adapter.ask !== 'function') {
    throw new Error('This adapter has no ask() method — update @smartmemory/graph or the SDK client it wraps.');
  }
  const trimmed = (question || '').trim();
  if (!trimmed) throw new Error('Enter a question first.');
  const normalized = normalizeAskResponse(await adapter.ask(trimmed, limit == null ? {} : { limit }));
  if (!normalized.answer) {
    throw new Error('The server returned no answer. Nothing was substituted for it.');
  }
  return normalized;
}
