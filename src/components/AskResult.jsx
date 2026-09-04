import {
  evidenceSelection,
  relationSelection,
  relationEdgeId,
} from '../core/askState';

/**
 * Presentational half of the Ask panel (DIST-LITE-9).
 *
 * Pure: it renders one ask result and reports clicks. All state lives in AskPanel, which
 * is what lets this be rendered and asserted without a DOM in tests.
 *
 * @param {Object} props
 * @param {{answer: string, reasoning: string, evidence: Array, relations: Array}} props.result
 * @param {function(string, Object): void} [props.onSelect] - Called with
 *   `(itemId, {kind:'evidence', item})` for an evidence row and
 *   `(edgeId, {kind:'relation', relation, sourceId, targetId})` for a relation row.
 *   A relation whose server payload carries no node ids is rendered but not clickable —
 *   a label pair cannot address a graph element.
 */
export default function AskResult({ result, onSelect }) {
  if (!result) return null;
  const { answer, reasoning, evidence, relations } = result;
  const selectable = typeof onSelect === 'function';

  return (
    <div className="sm-ask-result" data-testid="ask-result">
      <p className="sm-ask-answer" data-testid="ask-answer">{answer}</p>

      {reasoning ? (
        <details className="sm-ask-reasoning">
          <summary>Why</summary>
          <p data-testid="ask-reasoning">{reasoning}</p>
        </details>
      ) : null}

      {evidence.length > 0 ? (
        <section className="sm-ask-section">
          <h4 className="sm-ask-section-title">Evidence</h4>
          <ul className="sm-ask-list">
            {evidence.map((item) => (
              <li key={item.item_id}>
                <button
                  type="button"
                  className="sm-ask-row"
                  data-testid="ask-evidence-row"
                  data-item-id={item.item_id}
                  disabled={!selectable}
                  title={selectable ? 'Focus this memory in the graph' : undefined}
                  onClick={() => {
                    const payload = evidenceSelection(item);
                    if (payload) onSelect(payload[0], payload[1]);
                  }}
                >
                  <span className="sm-ask-row-content">{item.content}</span>
                  <span className="sm-ask-row-id">{item.item_id}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {relations.length > 0 ? (
        <section className="sm-ask-section">
          <h4 className="sm-ask-section-title">Relations used</h4>
          <ul className="sm-ask-list">
            {relations.map((relation) => {
              const edgeId = relationEdgeId(relation);
              return (
                <li key={edgeId || `${relation.source}-${relation.type}-${relation.target}`}>
                  <button
                    type="button"
                    className="sm-ask-row sm-ask-relation"
                    data-testid="ask-relation-row"
                    data-edge-id={edgeId || undefined}
                    disabled={!selectable || !edgeId}
                    title={
                      selectable && !edgeId
                        ? 'This relation came back without node ids, so it cannot be focused'
                        : undefined
                    }
                    onClick={() => {
                      const payload = relationSelection(relation);
                      if (payload) onSelect(payload[0], payload[1]);
                    }}
                  >
                    <span className="sm-ask-relation-source">{relation.source}</span>
                    <span className="sm-ask-relation-type">{relation.type}</span>
                    <span className="sm-ask-relation-target">{relation.target}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {evidence.length === 0 && relations.length === 0 ? (
        <p className="sm-ask-empty" data-testid="ask-no-evidence">
          No stored memories matched this question, so the answer above is not grounded in
          anything from this workspace.
        </p>
      ) : null}
    </div>
  );
}
