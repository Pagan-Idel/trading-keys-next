// src/utils/sessionUtils.ts

import { SESSION_LOCAL_SCHEDULE, SESSION_MAP } from "./constants.ts";

export function isSessionOpenUTC(session: string, now = new Date()): boolean {
  const schedule = SESSION_LOCAL_SCHEDULE[session as keyof typeof SESSION_LOCAL_SCHEDULE];
  if (!schedule) return false;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: schedule.timeZone,
    hour: '2-digit', minute: '2-digit', hour12: false, hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find(part => part.type === 'hour')?.value ?? -1);
  const minute = Number(parts.find(part => part.type === 'minute')?.value ?? 0);
  const localTime = hour + minute / 60;

  const { start, end } = schedule;
  return start < end
    ? localTime >= start && localTime < end
    : localTime >= start || localTime < end;
}

export function isTradeSessionOpen(pair: string, now = new Date()): boolean {
  const [base, quote] = pair.toUpperCase().split('/');
  const sessions = new Set([
    ...(SESSION_MAP[base] || []),
    ...(SESSION_MAP[quote] || [])
  ]);

  for (const session of sessions) {
    if (isSessionOpenUTC(session, now)) return true;
  }

  return false;
}
