import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

type PromotionDecision = {
  promoted?: unknown;
  backtestRunId?: unknown;
};

type PromotionEvidence = {
  decisions?: unknown;
};

const defaultDatabasePath = () =>
  path.resolve(process.cwd(), 'data', 'goldilocks-research.sqlite');

export const getPromotedResearchRunIds = (
  databasePath = defaultDatabasePath(),
): Set<string> => {
  const promoted = new Set<string>();
  if (!fs.existsSync(databasePath)) return promoted;

  const database = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const table = database.prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'research_campaigns'`,
    ).get();
    if (!table) return promoted;

    const columns = database.prepare('PRAGMA table_info(research_campaigns)').all() as
      Array<{ name: string }>;
    if (!columns.some(column => column.name === 'feedback_json')) return promoted;

    const rows = database.prepare(
      `SELECT feedback_json AS feedbackJson
       FROM research_campaigns
       WHERE feedback_json IS NOT NULL`,
    ).all() as Array<{ feedbackJson: string }>;

    for (const row of rows) {
      try {
        const evidence = JSON.parse(row.feedbackJson) as PromotionEvidence;
        if (!Array.isArray(evidence.decisions)) continue;
        for (const decision of evidence.decisions as PromotionDecision[]) {
          if (
            decision?.promoted === true &&
            typeof decision.backtestRunId === 'string' &&
            decision.backtestRunId.length > 0
          ) {
            promoted.add(decision.backtestRunId);
          }
        }
      } catch {
        // Malformed legacy feedback is not valid promotion evidence.
      }
    }
    return promoted;
  } finally {
    database.close();
  }
};
