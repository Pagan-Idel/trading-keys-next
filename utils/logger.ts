// Dummy logger for browser/serverless compatibility
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export const logMessage = (
  message: string,
  data?: unknown,
  options?: { level?: LogLevel; fileName?: string; pair?: string },
): void => {
  // Simple console log fallback
  if (data !== undefined) {
    console.log(`[${options?.level ?? 'info'}] ${message}`, data, options);
  } else {
    console.log(`[${options?.level ?? 'info'}] ${message}`, options);
  }
};
