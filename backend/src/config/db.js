import mongoose from 'mongoose';

export async function connectDB(uri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  process.stdout.write('MongoDB connected\n');
}
