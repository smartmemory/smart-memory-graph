import { describe, expect, it } from 'vitest';
import { getOriginTier } from '../src/core/originTiers.js';
import originContract from '../contracts/origin-contract.json';

// REL-CALLERS-ORIGIN-TAGS-1: the MCP origins a writer can emit. The legacy row stays, the
// memory_save family is tier 2, and an unregistered sibling is the control row (tier 4).
describe('origin contract mcp rows', () => {
  it.each([
    ['mcp:memory_save', 2],
    ['mcp:memory_save_document', 2],
    ['mcp:memory_save_conversation', 2],
    ['mcp:memory_add', 2],
    ['mcp:memory_zzz', 4],
  ])('getOriginTier(%s) is %i', (origin, tier) => {
    expect(getOriginTier(origin)).toBe(tier);
  });

  it('declares the three new keys with "tier": 2', () => {
    const rows = ['mcp:memory_save', 'mcp:memory_save_document', 'mcp:memory_save_conversation']
      .map((k) => [k, originContract.origins[k]?.tier]);
    expect(rows).toEqual(rows.map(([k]) => [k, 2]));
  });
});
