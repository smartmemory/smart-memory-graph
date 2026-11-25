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
  importance?: number
}

export interface EffectsEdge {
  id: string
  source: string
  target: string
  type: 'depends_on' | 'comes_from' | 'supersedes'
  derived?: boolean
  freshness?: Freshness
}
export interface EffectsGraphData { nodes: EffectsNode[], edges: EffectsEdge[] }

export type Resolution = { choice: 'replace' } | { choice: 'scoped', scope: string }
export interface Conflict {
  id: string // partner of the focused decision
  why: string
  freshness: Freshness
  resolution?: Resolution
}
export interface Review {
  id: string
  via: string
  hop: number
  state: 'preview' | 'checking' | 'flagged' | 'reviewed'
  freshness: Freshness
}

export interface DecisionEffectsSnapshot {
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
  possiblyRelated?: { id: string, label: string }[]
  // True counts beyond the supplied data, for the indicated working date.
  overflow?: { date: string, hop: number, count: number, branchId: string }[]
  sweepWatermark?: string
}

export interface EffectsActions {
  onCommit?: (focus: string, resolutions: Record<string, Resolution>) => void | Promise<void>
  onCancel?: (focus: string) => void
  onRefocus?: (branchId: string) => void
}
