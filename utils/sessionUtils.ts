// src/utils/sessionUtils.ts

import { SESSION_HOURS_UTC, SESSION_MAP } from "./constants.ts";

export function isSessionOpenUTC(session: string): boolean {
  const nowUTC = new Date().getUTCHours();
  const hours = SESSION_HOURS_UTC[session];
  if (!hours) return false;

  const { start, end } = hours;
  return start < end
    ? nowUTC >= start && nowUTC < end
    : nowUTC >= start || nowUTC < end; // handles overnight sessions like Sydney
}

export function isTradeSessionOpen(pair: string): boolean {
  const [base, quote] = pair.toUpperCase().split('/');
  const sessions = new Set([
    ...(SESSION_MAP[base] || []),
    ...(SESSION_MAP[quote] || [])
  ]);

  for (const session of sessions) {
    if (isSessionOpenUTC(session)) return true;
  }

  return false;
}
