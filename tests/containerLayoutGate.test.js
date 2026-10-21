import { describe, expect, it } from 'vitest';
import { containerHasArea, planContainerResize } from '../src/internal/useCytoscape.js';

// STUDIO-ONTOLOGY-GRAPH-LAYOUT-1: a layout run against a 0x0 container piles every node at the
// origin and fits a degenerate box. These pin the two decisions that keep that from happening:
// whether a layout may run now, and what the container ResizeObserver does when the size settles.

const cyWithRect = (width, height) => ({ container: () => ({ getBoundingClientRect: () => ({ width, height }) }) });

describe('containerHasArea', () => {
  // One row per shape of "no usable container", plus the sized case.
  const rows = [
    ['sized', cyWithRect(800, 400), true],
    ['0x0 (hidden tab)', cyWithRect(0, 0), false],
    ['width only (no height yet)', cyWithRect(800, 0), false],
    ['height only (no width yet)', cyWithRect(0, 400), false],
    ['no container (headless)', { container: () => null }, false],
    ['no cy', null, false],
  ];
  it.each(rows)('%s', (_name, cy, expected) => {
    expect(containerHasArea(cy)).toBe(expected);
  });
});

describe('planContainerResize', () => {
  // hadArea/hasArea are area (width AND height), not width alone.
  const base = { hadArea: false, hasArea: true, hasPendingLayout: false, nodeCount: 5, autoFit: true };
  const rows = [
    ['hidden -> sized, a layout was deferred: run it', { ...base, hasPendingLayout: true }, 'run-pending-layout'],
    ['hidden -> sized, nothing deferred: default relayout', base, 'relayout'],
    ['hidden -> sized with autoFit off still relays out', { ...base, autoFit: false }, 'relayout'],
    ['sized -> sized with autoFit: fit', { ...base, hadArea: true }, 'fit'],
    ['sized -> sized without autoFit: nothing', { ...base, hadArea: true, autoFit: false }, 'none'],
    ['hidden -> hidden: nothing (never fit a 0x0 box)', { ...base, hasArea: false }, 'none'],
    ['sized -> hidden: nothing', { ...base, hadArea: true, hasArea: false }, 'none'],
    ['no nodes: nothing, even on a size flip', { ...base, nodeCount: 0 }, 'none'],
  ];
  it.each(rows)('%s', (_name, input, expected) => {
    expect(planContainerResize(input)).toBe(expected);
  });
});
