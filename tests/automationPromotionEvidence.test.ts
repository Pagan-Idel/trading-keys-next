import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getPromotedResearchRunIds } from '../utils/automationPromotionEvidence.ts';

const createEvidenceDatabase = (feedback: Array<string | null>) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'promotion-evidence-'));
  const databasePath = path.join(directory, 'goldilocks-research.sqlite');
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE research_campaigns (
      id TEXT PRIMARY KEY,
      feedback_json TEXT
    )
  `);
  const insert = database.prepare(
    'INSERT INTO research_campaigns(id, feedback_json) VALUES(?, ?)',
  );
  feedback.forEach((value, index) => insert.run(String(index), value));
  database.close();
  return databasePath;
};

test('returns promoted backtest run IDs from feedback evidence', () => {
  const databasePath = createEvidenceDatabase([
    JSON.stringify({ decisions: [
      { promoted: true, backtestRunId: 'run-promoted' },
      { promoted: false, backtestRunId: 'run-rejected' },
    ] }),
  ]);
  assert.deepEqual([...getPromotedResearchRunIds(databasePath)], ['run-promoted']);
});

test('returns no IDs when no decision was promoted', () => {
  const databasePath = createEvidenceDatabase([
    JSON.stringify({ decisions: [{ promoted: false, backtestRunId: 'run-rejected' }] }),
    null,
  ]);
  assert.deepEqual([...getPromotedResearchRunIds(databasePath)], []);
});

test('deduplicates repeated promotion evidence', () => {
  const evidence = JSON.stringify({
    decisions: [{ promoted: true, backtestRunId: 'same-run' }],
  });
  const databasePath = createEvidenceDatabase([evidence, evidence]);
  assert.deepEqual([...getPromotedResearchRunIds(databasePath)], ['same-run']);
});

test('ignores malformed and incomplete promotion evidence', () => {
  const databasePath = createEvidenceDatabase([
    '{malformed',
    JSON.stringify({}),
    JSON.stringify({ decisions: null }),
    JSON.stringify({ decisions: [
      { promoted: true },
      { promoted: true, backtestRunId: '' },
      { promoted: 'true', backtestRunId: 'wrong-type' },
    ] }),
  ]);
  assert.deepEqual([...getPromotedResearchRunIds(databasePath)], []);
});

test('missing evidence is read-only and cannot start research', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'promotion-evidence-missing-'));
  const databasePath = path.join(directory, 'missing.sqlite');
  assert.deepEqual([...getPromotedResearchRunIds(databasePath)], []);
  assert.equal(fs.existsSync(databasePath), false);

  const source = fs.readFileSync(path.resolve('utils/automationPromotionEvidence.ts'), 'utf8');
  assert.doesNotMatch(source, /child_process|spawn|fork|autoResearchRunner/);
});
