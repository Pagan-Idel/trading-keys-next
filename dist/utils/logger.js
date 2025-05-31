import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Client-side logger that sends logs to a server API
export async function logToFileAsync(...args) {
    const logMessage = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' ');
    const timestamp = new Date().toISOString();
    await fetch('http://localhost:4000/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timestamp, message: logMessage }),
    });
}
// utils/logger.ts or wherever your logger lives
const logsDir = path.join(__dirname, '../../logs');
const strategyLogFile = path.join(logsDir, 'strategyLogs.txt');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}
export function logMessage(message, data) {
    const timestamp = new Date().toISOString();
    let fullMessage = `[${timestamp}] ${message}`;
    if (data !== undefined) {
        try {
            fullMessage += ` | ${JSON.stringify(data)}`;
        }
        catch {
            fullMessage += ` | [Unable to stringify data]`;
        }
    }
    fullMessage += '\n';
    fs.appendFile(strategyLogFile, fullMessage, (err) => {
        if (err) {
            console.error("❌ Failed to write to strategyLogs.txt:", err);
        }
    });
}
