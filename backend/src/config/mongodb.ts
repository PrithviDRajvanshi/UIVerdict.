import mongoose from 'mongoose';
import { config } from './env';

export async function connectMongoDB(): Promise<void> {
  try {
    if (mongoose.connection.readyState >= 1) {
      return;
    }
    await mongoose.connect(config.mongodbUri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log('✅ MongoDB connected via Mongoose');
  } catch (error: any) {
    console.error('⚠️ MongoDB connection failed:', error?.message || error);
  }
}

export async function disconnectMongoDB(): Promise<void> {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log('MongoDB disconnected');
    }
  } catch (error: any) {
    console.error('Error disconnecting MongoDB:', error?.message || error);
  }
}
