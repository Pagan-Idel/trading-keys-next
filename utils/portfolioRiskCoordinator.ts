import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  assessPortfolioMarginAdmission,
  DEFAULT_PORTFOLIO_MARGIN_POLICY,
  type PortfolioMarginAdmission,
  type PortfolioMarginPolicy,
} from "./portfolioMargin.ts";

export interface BrokerMarginSnapshot {
  nav: number;
  marginAvailable: number;
  marginUsed: number;
  marginCloseoutNav: number;
  marginCloseoutPercent: number;
  openTradeCount: number;
}

export interface MarginReservationRequest {
  pair: string;
  mode: "live" | "demo";
  proposedMargin: number;
  proposedRiskAmount: number;
  account: BrokerMarginSnapshot;
}

export interface MarginReservationResult extends PortfolioMarginAdmission {
  reservationId?: string;
  reservedMargin: number;
  reservedRiskAmount: number;
  knownOpenRiskAmount: number;
  unknownOpenTradeCount: number;
}

const DATABASE_PATH = path.resolve(
  process.cwd(),
  "data",
  "automation.sqlite",
);

export class PortfolioRiskCoordinator {
  private readonly database: Database.Database;

  constructor(
    private readonly policy: PortfolioMarginPolicy =
      DEFAULT_PORTFOLIO_MARGIN_POLICY,
    databasePath = DATABASE_PATH,
  ) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("busy_timeout = 5000");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS portfolio_margin_reservations (
        reservation_id TEXT PRIMARY KEY,
        pair TEXT NOT NULL,
        mode TEXT NOT NULL,
        proposed_margin REAL NOT NULL,
        proposed_risk_amount REAL NOT NULL,
        status TEXT NOT NULL,
        trade_id TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_portfolio_margin_reservations_mode_expiry
        ON portfolio_margin_reservations(mode,expires_at);
    `);
  }

  reserve(request: MarginReservationRequest): MarginReservationResult {
    const now = Date.now();
    const reservationId = randomUUID();
    const reserveTransaction = this.database.transaction(() => {
      this.database
        .prepare("DELETE FROM portfolio_margin_reservations WHERE expires_at <= ?")
        .run(now);
      const reserved = this.database
        .prepare(
          `SELECT COALESCE(SUM(proposed_margin),0) AS margin,
                  COALESCE(SUM(proposed_risk_amount),0) AS risk
           FROM portfolio_margin_reservations
           WHERE mode=? AND expires_at>?`,
        )
        .get(request.mode, now) as { margin: number; risk: number };
      const activeTable = this.database
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type='table' AND name='active_trades'`,
        )
        .get() as { name?: string } | undefined;
      const active = activeTable
        ? (this.database
            .prepare(
              `SELECT COUNT(*) AS count,
                      COALESCE(SUM(CASE WHEN risk_percentage IS NULL
                        THEN 0 ELSE risk_percentage END),0) AS riskPercent,
                      COALESCE(SUM(CASE WHEN risk_percentage IS NULL
                        THEN 1 ELSE 0 END),0) AS missingRisk
               FROM active_trades WHERE mode=?`,
            )
            .get(request.mode) as {
            count: number;
            riskPercent: number;
            missingRisk: number;
          })
        : { count: 0, riskPercent: 0, missingRisk: 0 };
      const unknownOpenTradeCount = Math.max(
        active.missingRisk,
        request.account.openTradeCount - active.count,
        0,
      );
      const knownOpenRiskAmount =
        request.account.nav * (active.riskPercent / 100);
      const unknownOpenRiskAmount =
        request.account.nav *
        this.policy.unknownOpenTradeRiskFraction *
        unknownOpenTradeCount;
      const admission = assessPortfolioMarginAdmission(
        {
          nav: request.account.nav,
          marginAvailable: request.account.marginAvailable,
          marginUsed: request.account.marginUsed,
          marginCloseoutNav: request.account.marginCloseoutNav,
          marginCloseoutPercent: request.account.marginCloseoutPercent,
          reservedMargin: Number(reserved.margin) || 0,
          openRiskAmount: knownOpenRiskAmount + unknownOpenRiskAmount,
          reservedRiskAmount: Number(reserved.risk) || 0,
          proposedMargin: request.proposedMargin,
          proposedRiskAmount: request.proposedRiskAmount,
        },
        this.policy,
      );
      if (admission.allowed) {
        this.database
          .prepare(
            `INSERT INTO portfolio_margin_reservations(
              reservation_id,pair,mode,proposed_margin,proposed_risk_amount,
              status,created_at,expires_at
            ) VALUES(?,?,?,?,?,'pending',?,?)`,
          )
          .run(
            reservationId,
            request.pair,
            request.mode,
            request.proposedMargin,
            request.proposedRiskAmount,
            now,
            now + this.policy.reservationTtlMs,
          );
      }
      return {
        ...admission,
        reservationId: admission.allowed ? reservationId : undefined,
        reservedMargin: Number(reserved.margin) || 0,
        reservedRiskAmount: Number(reserved.risk) || 0,
        knownOpenRiskAmount,
        unknownOpenTradeCount,
      };
    });
    return reserveTransaction.immediate();
  }

  markFilled(reservationId: string, tradeId?: string): void {
    this.database
      .prepare(
        `UPDATE portfolio_margin_reservations
         SET status='filled',trade_id=?,expires_at=?
         WHERE reservation_id=?`,
      )
      .run(
        tradeId ?? null,
        Date.now() + this.policy.reservationTtlMs,
        reservationId,
      );
  }

  release(reservationId: string): void {
    this.database
      .prepare(
        "DELETE FROM portfolio_margin_reservations WHERE reservation_id=?",
      )
      .run(reservationId);
  }

  close(): void {
    this.database.close();
  }
}
