import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { expect, it } from 'vitest';
import decisions from '../contracts/decisions.json';
import schema from '../contracts/decision-effects.json';
import { email, friday, pilots, refunds, standing, committedEmail, crowded } from './fixtures/decisionEffects.js';

it('validates the frozen-notes renderer snapshots and rejects stored marks on the phase 1 wire', () => {
  const ajv = new Ajv2020();
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const scoped = committedEmail({ eu: { choice: 'scoped', scope: 'Marketing email only' } });
  for (const fixture of [email, friday, pilots, refunds, standing, scoped, crowded()]) {
    expect(fixture.decisionEffects.data).toBe(fixture.data);
    expect(validate(fixture.decisionEffects), JSON.stringify(validate.errors)).toBe(true);
  }
  for (const name of ['effects', 'effects_preview', 'effects_commit', 'depends_on']) {
    for (const key of ['request', 'reply']) {
      const [file, pointer] = decisions._routes[name][key].split('#');
      expect(file).toBe('decision-effects.json');
      expect(ajv.getSchema('#' + pointer)).toBeTypeOf('function');
    }
  }
  const preview = ajv.getSchema('#/$defs/PreviewResponse');
  const { conflict_check, ...legacy } = friday.decisionEffects;
  expect(preview(legacy)).toBe(false);
  expect(preview({ ...legacy, conflict_check })).toBe(true);
  const partial = { state: 'partial', checked: 100, cap: 10, omitted: 3, ceiling: 100, save_allowed: false, omitted_at_least: false };
  for (const valid of [{ ...conflict_check, checked: 55 }, { state: 'no_related_rule', checked: 0, cap: 10, omitted: 0 },
    partial, { ...partial, save_allowed: true, omitted_at_least: true }, { state: 'could_not_check', checked: 20, cap: 10, omitted: 0 }]) {
    expect(preview({ ...legacy, conflict_check: valid }), JSON.stringify(valid)).toBe(true);
  }
  const { ceiling, ...noCeiling } = partial;
  for (const invalid of [{ ...conflict_check, checked: 0 }, { ...conflict_check, omitted: 1 },
    { ...conflict_check, state: 'nothing_to_check' }, { ...conflict_check, state: 'no_related_rule' }, noCeiling,
    { ...partial, omitted: 0 }, { ...conflict_check, save_allowed: true }, { ...partial, ceiling: ceiling + 1000 }]) {
    expect(preview({ ...legacy, conflict_check: invalid }), JSON.stringify(invalid)).toBe(false);
  }
  const commit = ajv.getSchema('#/$defs/CommitRequest');
  expect(commit({ text: 'A draft' })).toBe(false);
  for (const resolution of [{ choice: 'replace' }, { choice: 'keep_both_scoped', scope: 'marketing only' }, { choice: 'cancel' }]) {
    expect(commit({ text: 'A draft', resolutions: { eu: resolution } })).toBe(true);
  }
  expect(commit({ text: 'A draft', resolutions: { eu: { choice: 'keep_both_scoped', scope: ' ' } } })).toBe(false);
  const draft = email.decisionEffects;
  for (const freshness of [{ kind: 'stored' }, { kind: 'computed', checked_as_of: draft.today }]) {
    expect(validate({ ...draft, conflicts: [{ ...draft.conflicts[0], freshness }] })).toBe(false);
  }
});

it('validates A10 link provenance, setting, suggestion rows and path-only mutations', async () => {
  const { suggestedPilots } = await import('./fixtures/decisionEffects.js');
  const ajv = new Ajv2020();
  addFormats(ajv);
  const validate = ajv.compile(schema);
  for (const mode of ['dashed', 'suggest_only', 'treat_as_real']) {
    const draft = suggestedPilots(mode);
    expect(validate(draft), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...draft, suggestedLinks: 'unknown' })).toBe(false);
  }
  const billing = suggestedPilots('suggest_only', true);
  expect(validate(billing)).toBe(true);
  expect(validate({ ...billing, suggestions: [{ source: 'billing', target: 'pilot' }] })).toBe(false);
  const draft = suggestedPilots('dashed');
  draft.data.edges[0].suggested = 'yes';
  expect(validate(draft)).toBe(false);
  draft.data.edges[0].suggested = true;
  draft.data.nodes[0].viaSuggested = 'yes';
  expect(validate(draft)).toBe(false);
  expect(decisions._routes.confirm_depends_on).toBe('POST /memory/decisions/{id}/depends-on/{target_id}/confirm');
  expect(decisions._routes.remove_depends_on).toBe('DELETE /memory/decisions/{id}/depends-on/{target_id}');
});
