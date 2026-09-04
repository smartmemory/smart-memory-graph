import { useCallback, useReducer, useRef, useState } from 'react';
import AskResult from './AskResult';
import {
  ASK_ANSWERED,
  ASK_ERROR,
  ASK_LOADING,
  INITIAL_ASK_STATE,
  askReducer,
  runAsk,
} from '../core/askState';

/**
 * Ask panel — a question box over `POST /memory/ask` (DIST-LITE-9).
 *
 * Standalone: it needs only an adapter, and it renders the same against the lite daemon
 * on port 9014 and the hosted API, because both serve the identical contract
 * (docs/features/DIST-LITE-9/ask-contract.json). It has no viewer-specific imports and
 * no dependency on GraphExplorer — a host places the two side by side and connects them
 * through `onSelect`.
 *
 * @param {Object} props
 * @param {import('../adapters/types').GraphAPIAdapter} props.adapter - Must expose `ask()`.
 * @param {function(string, Object): void} [props.onSelect] - Fired when a row is clicked.
 *   Evidence rows pass `(item_id, {kind:'evidence', item})`; relation rows pass
 *   `(edgeId, {kind:'relation', relation, sourceId, targetId})` where `edgeId` is
 *   `${source_id}->${target_id}:${type}` — the same id `normalizeAPIResponse` builds, so
 *   it can be handed straight to a Cytoscape lookup. A host whose graph focuses nodes
 *   only can use `meta.sourceId`.
 * @param {number} [props.limit=5] - How many memories to retrieve as evidence.
 * @param {string} [props.placeholder] - Input placeholder.
 * @param {string} [props.className] - Additional CSS classes on the root element.
 */
export default function AskPanel({
  adapter,
  onSelect,
  limit = 5,
  placeholder = 'Ask a question about your memories…',
  className = '',
}) {
  const [state, dispatch] = useReducer(askReducer, INITIAL_ASK_STATE);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  const submit = useCallback(
    async (event) => {
      if (event) event.preventDefault();
      const question = draft.trim();
      if (!question || state.status === ASK_LOADING) return;
      dispatch({ type: 'submit', question });
      try {
        const result = await runAsk(adapter, question, { limit });
        dispatch({ type: 'resolve', question, result });
      } catch (err) {
        // Surfaced, never swallowed: an ask that could not be answered must read as a
        // failure, not as an empty answer (.claude/rules/no-silent-degradation.md).
        dispatch({ type: 'reject', question, error: err?.message || String(err) });
      }
    },
    [adapter, draft, limit, state.status]
  );

  const loading = state.status === ASK_LOADING;

  return (
    <div className={`sm-ask-panel ${className}`.trim()} data-testid="ask-panel">
      <form className="sm-ask-form" onSubmit={submit}>
        <input
          ref={inputRef}
          type="text"
          className="sm-ask-input"
          data-testid="ask-input"
          value={draft}
          placeholder={placeholder}
          aria-label="Ask a question about your memories"
          onChange={(e) => setDraft(e.target.value)}
          disabled={loading}
        />
        <button
          type="submit"
          className="sm-ask-submit"
          data-testid="ask-submit"
          disabled={loading || !draft.trim()}
        >
          {loading ? 'Asking…' : 'Ask'}
        </button>
      </form>

      {loading ? (
        <p className="sm-ask-status" data-testid="ask-loading">
          Searching memory and asking the model…
        </p>
      ) : null}

      {state.status === ASK_ERROR ? (
        <p className="sm-ask-error" role="alert" data-testid="ask-error">
          {state.error}
        </p>
      ) : null}

      {state.status === ASK_ANSWERED ? (
        <AskResult result={state.result} onSelect={onSelect} />
      ) : null}
    </div>
  );
}
