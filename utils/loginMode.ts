const args = process.argv.slice(2);
export const loginMode = args.find(arg => arg.startsWith('--mode='))?.split('=')[1] ?? 'demo';
