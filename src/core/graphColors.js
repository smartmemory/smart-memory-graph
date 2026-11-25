import graphColors from '../../contracts/graph-colors.json';
import annotationContract from '../../contracts/graph-annotations.json';

export const MEMORY_COLORS = {
  memory: graphColors.special.memory,
  ...graphColors.memoryTypes,
};

export const ENTITY_COLORS = { ...graphColors.entityTypes };

export const SPECIAL_COLORS = {
  grounding: graphColors.special.grounding,
  default: graphColors.special.default,
};

// An unknown origin is shown plainly: no colour, so no border, no red, no dash (owner 2026-11-25,
// UI-ORIGIN-UNKNOWN-NEUTRAL-1). The contract still lists a colour for it; it is not drawn.
export const ORIGIN_BORDER_COLORS = { ...(graphColors.originPrefixes || {}), unknown: null };

// Maps raw first-segment prefixes to conceptual origin groups for border colors.
const PREFIX_GROUP_MAP = {
  cli: 'user',
  api: 'user',
  mcp: 'user',
  structured: 'hook',
  user: 'user',
  conversation: 'conversation',
  code: 'code',
  evolver: 'evolver',
  enricher: 'enricher',
  hook: 'hook',
  import: 'import',
};

export function getOriginPrefix(origin) {
  if (!origin || origin === 'unknown') return 'unknown';
  const raw = origin.split(':')[0];
  return PREFIX_GROUP_MAP[raw] ?? 'unknown';
}

export function getOriginBorderColor(origin) {
  const prefix = getOriginPrefix(origin);
  return ORIGIN_BORDER_COLORS[prefix] ?? null;
}

export const NODE_SIZES = { memory: 14, entity: 8, grounding: 8 };

export function getNodeColor(type, category) {
  if (category === 'memory' || MEMORY_COLORS[type]) return MEMORY_COLORS[type] || MEMORY_COLORS.memory;
  if (ENTITY_COLORS[type]) return ENTITY_COLORS[type];
  if (SPECIAL_COLORS[type]) return SPECIAL_COLORS[type];
  return SPECIAL_COLORS.default;
}

/**
 * Blend a hex color toward slate-400 (#94a3b8) by the given ratio.
 * ratio=0 returns original color; ratio=1 returns full grey.
 * Used for temporal decay desaturation in graph styles.
 */
export function desaturateColor(hex, ratio) {
  if (!hex || !hex.startsWith('#') || hex.length < 7) return hex;
  const grey = [0x94, 0xa3, 0xb8];
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const nr = Math.round(r + (grey[0] - r) * ratio);
  const ng = Math.round(g + (grey[1] - g) * ratio);
  const nb = Math.round(b + (grey[2] - b) * ratio);
  return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

export function getNodeSize(category) {
  return NODE_SIZES[category] || NODE_SIZES.entity;
}

export const ALL_MEMORY_TYPES = Object.keys(MEMORY_COLORS);
export const ALL_ENTITY_TYPES = Object.keys(ENTITY_COLORS);

// Set of actual memory types (excludes 'memory' which is just a fallback color key)
export const MEMORY_TYPE_SET = new Set(ALL_MEMORY_TYPES.filter((t) => t !== 'memory'));

// Annotation constants (from contracts/graph-annotations.json)
export const ANNOTATION_COLORS = annotationContract.colors;
export const ANNOTATION_BORDERS = annotationContract.borders;
export const ANNOTATION_KINDS = Object.keys(annotationContract.annotationKinds);
export const ANNOTATION_PRECEDENCE = annotationContract.defaultPrecedence;
export const CHANNEL_LOCKED_KINDS = annotationContract.channelLockedKinds;
