import app from './app';
import { config } from './config';
import { connectPostgres } from './config/postgres';
import { connectMongoDB } from './config/mongodb';

const PORT = config.port;

const startServer = async () => {
  await Promise.allSettled([connectPostgres(), connectMongoDB()]);

  const serverInstance = app.listen(PORT, () => {
    console.log(`🚀 Server listening on port ${PORT} in ${config.nodeEnv} mode`);
  });

  // Extend timeouts to 5 minutes (300,000 ms) to support long-running analysis workflows
  serverInstance.timeout = 300000;
  serverInstance.requestTimeout = 300000;
  serverInstance.headersTimeout = 300000;
  serverInstance.keepAliveTimeout = 60000;

  return serverInstance;
};

const server = startServer();

process.on('unhandledRejection', (reason: Error) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

export default server;

