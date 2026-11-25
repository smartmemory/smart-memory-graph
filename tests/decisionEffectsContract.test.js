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
