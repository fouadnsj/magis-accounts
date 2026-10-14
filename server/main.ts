// Entry point of the server program (started by Windows at boot on the mini-PC).
// Options for testing only:  --data=<folder>   --http-only (no HTTPS, port 8080)
import { startServer } from './server';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}`))?.split('=')[1] ?? (process.argv.includes(`--${name}`) ? '' : undefined);

startServer({
  dataDir: arg('data') || undefined,
  config: arg('http-only') !== undefined ? { httpMode: 'serve' } : undefined,
}).then(
  (srv) => {
    const stop = async () => {
      await srv.close();
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  },
  (e) => {
    console.error('MAGIS server could not start:', e);
    process.exit(1);
  },
);
