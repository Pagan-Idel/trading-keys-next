// Client-side logger that sends logs to a server API
 export async function logToFileAsync(...args: any[]): Promise<void> {
    const logMessage = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' ');
    const timestamp = new Date().toISOString();

    await fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timestamp, message: logMessage }),
    });
}