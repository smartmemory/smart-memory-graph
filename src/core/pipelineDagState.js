/**
 * Pure state derivation for VIS-PIPELINE-DAG-1.
 *
 * Maps PLAT-PROGRESS-1's fixed status enum (started | progress | ok | warn |
 * error) plus payload.reason conventions onto DAG UI states. Pure functions
 * for unit testability.
 *
 * See: docs/features/VIS-PIPELINE-DAG-1/design.md §Status updates
 */

export const UI_STATES = Object.freeze({
  PENDING: 'pending',
  ACTIVE: 'active',
  COMPLETE: 'complete',
  SKIPPED: 'skipped',
  TIMED_OUT: 'timed_out',
  ERRORED: 'errored',
  NEVER_ENTERED: 'never_entered',
});

const TERMINAL_UI_STATES = new Set([
  UI_STATES.COMPLETE,
  UI_STATES.SKIPPED,
  UI_STATES.TIMED_OUT,
  UI_STATES.ERRORED,
]);

// Cap per-stage event logs so long runs can't grow memory unboundedly.
export const MAX_EVENTS_PER_STAGE = 50;

/**
 * Append a staged progress event to the per-stage log map (immutable update,
 * capped at MAX_EVENTS_PER_STAGE per stage).
 *
 * Kind-agnostic on purpose: the log panel shows every event that names a
 * stage (`pipeline.stage`, `studio.job`, `evolver.result`, …) so wrapper-job
 * events like Studio's relink are visible, while the DAG state machine stays
 * `pipeline.stage`-only (deriveStageStatus).
 *
 * @param {Object<string, Object[]>} eventsByStage - Previous log map.
 * @param {Object} progressEvent - ProgressEvent; ignored if it has no stage.
 * @returns {Object<string, Object[]>} Next log map (same object if no stage).
 */
export function appendStagedEvent(eventsByStage, progressEvent) {
  const stage = progressEvent?.stage;
  if (!stage) return eventsByStage;
  const list = eventsByStage[stage] || [];
  const next = list.length >= MAX_EVENTS_PER_STAGE
    ? [...list.slice(-(MAX_EVENTS_PER_STAGE - 1)), progressEvent]
    : [...list, progressEvent];
  return { ...eventsByStage, [stage]: next };
}

/**
 * Map a single ProgressEvent (kind=pipeline.stage) onto the new UI state
 * for the stage it references, given the previous UI state.
 *
 * Once a stage has reached a terminal UI state, subsequent events are
 * ignored — this prevents a late-arriving `progress` event from clobbering
 * a terminal `ok`/`warn`/`error`.
 *
 * @param {Object} args
 * @param {string} [args.previous] - Previous UI state for this stage.
 * @param {string} args.status     - Event status (PLAT-PROGRESS-1 enum).
 * @param {Object} [args.payload]  - Event payload (may contain `reason`).
 * @returns {string} Next UI state.
 */
export function deriveStageStatus({ previous, status, payload }) {
  // Terminal states are sticky.
  if (previous && TERMINAL_UI_STATES.has(previous)) {
    return previous;
  }

  if (status === 'started' || status === 'progress') {
    return UI_STATES.ACTIVE;
  }

  if (status === 'ok') {
    return UI_STATES.COMPLETE;
  }

  if (status === 'warn') {
    const reason = payload && payload.reason;
    // payload.timed_out: true is a documented design.md fallback for producers
    // that signal timeout via a boolean rather than a reason string.
    if (reason === 'timed_out' || (payload && payload.timed_out === true)) {
      return UI_STATES.TIMED_OUT;
    }
    if (reason === 'procedure_match' || reason === 'skipped') return UI_STATES.SKIPPED;
    // warn with no reason → treat as complete-with-warning; renderer can
    // distinguish via metadata if needed. Keeping this conservative: a warn
    // without a known reason is closer to "done" than "errored".
    return UI_STATES.COMPLETE;
  }

  if (status === 'error') {
    return UI_STATES.ERRORED;
  }

  // Unknown status — keep the previous state (or pending if first event).
  return previous || UI_STATES.PENDING;
}

/**
 * After a run is finished, mark any pending DAG nodes as never_entered.
 *
 * @param {Array<{id: string}>} dagNodes  - Nodes from pipeline.dag payload.
 * @param {Object<string, string>} statusByStage - Current UI states keyed by stage id.
 * @returns {Object<string, string>} New status map with never_entered fills.
 */
export function fillNeverEntered(dagNodes, statusByStage) {
  const next = { ...statusByStage };
  for (const node of dagNodes || []) {
    if (!next[node.id]) {
      next[node.id] = UI_STATES.NEVER_ENTERED;
    }
  }
  return next;
}
