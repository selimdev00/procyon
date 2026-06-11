import mongoose from "mongoose";

export async function connectMongo(uri: string): Promise<typeof mongoose> {
  return mongoose.connect(uri);
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}
