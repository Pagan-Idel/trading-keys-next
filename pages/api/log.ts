// pages/api/log.ts
import { promises as fs } from 'fs';
import { NextApiRequest, NextApiResponse } from 'next';
import path from 'path';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === 'POST') {
        const { timestamp, message } = req.body;

        const logFilePath = path.join(process.cwd(), 'logs', 'client.log');
        const logEntry = `[${timestamp}] ${message}\n`;

        await fs.mkdir(path.dirname(logFilePath), { recursive: true });
        await fs.appendFile(logFilePath, logEntry, 'utf8');

        res.status(200).json({ success: true });
    } else {
        res.status(405).json({ message: 'Method not allowed' });
    }
}
