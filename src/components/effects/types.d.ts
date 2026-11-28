// Controlled presentation inputs. Dates use YYYY-MM-DD in the workspace calendar.
export type Freshness =
  | { kind: 'computed' }
  | { kind: 'stored', checked_as_of: string, stale?: boolean }

export interface EffectsNode {
  id: string
  label: string
  type: 'decision' | 'note' | 'entity'
  hop: number // standing neighbourhood distance from focus
  validFrom: string
  retiredAt?: string
  retirement?: 'replaced' | 'retracted'
  reason?: string
  rejected?: string[]
  ruleKind?: 'must' | 'must-not'
  check?: 'compiled' | 'unchecked' | 'stale'
  viaSuggested?: boolean
  importance?: number
}

export interface EffectsEdge {
  id: string
  source: string
  target: string
  type: 'depends_on' | 'comes_from' | 'supersedes'
  suggested?: boolean
  derived?: boolean
  freshness?: Freshness
}
export interface EffectsGraphData { nodes: EffectsNode[], edges: EffectsEdge[] }

export type Resolution = { choice: 'replace' } | { choice: 'scoped', scope: string }
export interface Conflict {
  id: string // partner of the focused decision
  why: string
  freshness: Freshness
  resolution?: Resolution | Settlement
}
export interface Review {
  id: string
  via: string
  hop: number // shortest distance to the retired rule; no maximum (DEMO-1204-RIPPLE-NO-HOP-LIMIT-1)
  state: 'preview' | 'checking' | 'flagged' | 'reviewed'
  freshness: Freshness
}

export interface EffectsPresentation {
  suggestedLinks?: 'suggest_only' | 'dashed' | 'treat_as_real'
  suggestions?: { source: string, target: string, reason: string }[]
  focus: string
  today: string
  revision?: string // change when replacing a draft or its authoritative conflict set
  phase: 'draft' | 'standing' | 'held'
  policy?: 'save' | 'propose'
  replaces: string[]
  conflicts: Conflict[]
  review: Review[]
  freshness: Freshness
  // Ordered provenance, source first, up to five edges. Each pair has a graph edge.
  whyPaths?: Record<string, string[]>
  counts?: { conflicts: number, replaced: number, to_review: number }
  possibly_related?: { id: string, label: string }[]
  possiblyRelated?: { id: string, label: string }[]
  // True counts beyond the supplied data, for the indicated working date.
  overflow?: { date: string, hop: number, count: number, branchId: string }[]
  sweepWatermark?: string
}

// Phase 1 HTTP reply. Stored marks remain available to presentation-only hosts.
type Computed = { kind: 'computed' }
export type Settlement = { choice: 'replace' } | { choice: 'keep_both_scoped', scope: string }
export type CommitResolution = Settlement | { choice: 'cancel' }

export interface DecisionEffectsSnapshot extends Omit<EffectsPresentation, 'possiblyRelated' | 'sweepWatermark'> {
  data: {
    nodes: (EffectsNode & { check?: 'unchecked' })[]
    edges: (EffectsEdge & { freshness?: Computed })[]
  }
  freshness: Computed
  conflicts: (Omit<Conflict, 'resolution'> & { freshness: Computed, resolution?: Settlement })[]
  review: (Review & { freshness: Computed, state: 'preview' | 'flagged' })[]
  counts: NonNullable<EffectsPresentation['counts']>
  possibly_related: NonNullable<EffectsPresentation['possibly_related']>
  overflow: NonNullable<EffectsPresentation['overflow']>
}

export interface EffectsActions {
  onReadHistory?: (focus: string, options: { as_of: string, show_retired: boolean }) => Promise<DecisionEffectsSnapshot>
  onHistoryWarning?: (reason: unknown) => void
  onConfirmLink?: (source: string, target: string) => void
  onRemoveLink?: (source: string, target: string) => void
  onCommit?: (focus: string, resolutions: Record<string, Resolution>) => void | Promise<void>
  onCancel?: (focus: string) => void
  onRefocus?: (branchId: string) => void
}
