import app from './app';
import { config } from './config';

const PORT = config.port;

const server = app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT} in ${config.nodeEnv} mode`);
});

process.on('unhandledRejection', (reason: Error) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

export default server;
