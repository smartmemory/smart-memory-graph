import { describe, expect, it } from 'vitest';
import { removeIdsFromSelection } from '../src/internal/useCytoscape';

describe('removeIdsFromSelection', () => {
  it('removes only deleted nodes from the current selection', () => {
    const next = removeIdsFromSelection(new Set(['keep-a', 'delete-me', 'keep-b']), ['delete-me']);

    expect([...next].sort()).toEqual(['keep-a', 'keep-b']);
  });

  it('leaves an unrelated selection untouched in content when removed ids are not selected', () => {
    const current = new Set(['keep-a', 'keep-b']);
    const next = removeIdsFromSelection(current, ['unrelated-node']);

    expect([...next].sort()).toEqual(['keep-a', 'keep-b']);
    expect(next.size).toBe(current.size);
  });
});
