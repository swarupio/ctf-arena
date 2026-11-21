import mongoose from 'mongoose';

export async function connectDB(uri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 10, minPoolSize: 1, maxIdleTimeMS: 60000 });
  process.stdout.write('MongoDB connected\n');
}
