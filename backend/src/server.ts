import app from './app';
import { config } from './config';
import { connectPostgres } from './config/postgres';
import { connectMongoDB } from './config/mongodb';

const PORT = config.port;

const startServer = async () => {
  Promise.allSettled([connectPostgres(), connectMongoDB()]);

  return app.listen(PORT, () => {
    console.log(`🚀 Server listening on port ${PORT} in ${config.nodeEnv} mode`);
  });
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

