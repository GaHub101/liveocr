import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalRef, editDistance, matchRef } from '../src/refmatch.js';

const KNOWN = ['630-0032', '630-0033', '012345A', 'BO-1108', 'AB12', '497-0010'];

test('canonicalRef faltet Trennzeichen und verwechselbare Zeichen', () => {
  assert.equal(canonicalRef('63O-0032'), '6300032');
  assert.equal(canonicalRef(' bo-1l08 '), '801108');
  assert.equal(canonicalRef('630 0032'), canonicalRef('630-0032'));
});

test('editDistance', () => {
  assert.equal(editDistance('abc', 'abc'), 0);
  assert.equal(editDistance('abc', 'abd'), 1);
  assert.equal(editDistance('abc', 'abcd'), 1);
  assert.equal(editDistance('abc', 'xyz', 1), 2);  // früher Abbruch: > max
});

test('exakter Treffer (Gross/Klein und Leerzeichen egal)', () => {
  assert.deepEqual(matchRef('630-0032', KNOWN), { type: 'exact', ref: '630-0032' });
  assert.deepEqual(matchRef('bo-1108', KNOWN),  { type: 'exact', ref: 'BO-1108' });
  assert.deepEqual(matchRef('012345 A', KNOWN), { type: 'exact', ref: '012345A' });
});

test('verwechselbare Zeichen und fehlende Trennzeichen → Vorschlag', () => {
  assert.deepEqual(matchRef('63O-OO32', KNOWN).candidates[0], '630-0032');
  assert.deepEqual(matchRef('6300032', KNOWN).candidates[0], '630-0032');
  assert.deepEqual(matchRef('80-1108', KNOWN), { type: 'near', candidates: ['BO-1108'] });
});

test('ein Zeichen falsch/fehlend → Vorschlag, bester zuerst', () => {
  assert.deepEqual(matchRef('497-001', KNOWN), { type: 'near', candidates: ['497-0010'] });
  const r = matchRef('630-0034', KNOWN);
  assert.equal(r.type, 'near');
  assert.deepEqual(r.candidates, ['630-0032', '630-0033']);
});

test('exakter Treffer gewinnt, auch wenn Nachbarn existieren', () => {
  assert.equal(matchRef('630-0033', KNOWN).type, 'exact');
});

test('kurze REFs und Unbekanntes → kein Vorschlag', () => {
  assert.deepEqual(matchRef('AB13', KNOWN), { type: 'none' });
  assert.deepEqual(matchRef('999-9999', KNOWN), { type: 'none' });
  assert.deepEqual(matchRef('', KNOWN), { type: 'none' });
  assert.deepEqual(matchRef('630-0032', []), { type: 'none' });
});
