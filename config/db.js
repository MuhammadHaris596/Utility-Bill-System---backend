const mongoose = require('mongoose');
const dns = require('dns');

// Fix for Windows DNS SRV query ECONNREFUSED on MongoDB Atlas
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {
  console.warn('Could not set custom DNS servers:', e.message);
}

/**
 * Global is used here to maintain a cached connection across hot reloads
 * in development and serverless function invocations in Vercel.
 */
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

const connectDB = async () => {
  // If connection is already established and active (readyState === 1), reuse it
  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  // If connection exists but was disconnected (readyState === 0), clear cache
  if (cached.conn && mongoose.connection.readyState === 0) {
    cached.conn = null;
    cached.promise = null;
  }

  // If no connection promise exists, initiate a new connection attempt
  if (!cached.promise) {
    const opts = {
      bufferCommands: false, // Fail fast if DB is disconnected instead of buffering and hanging requests
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10,
      socketTimeoutMS: 45000,
      // Force IPv4 DNS resolution to avoid ENOTFOUND on some Windows networks
      family: 4,
    };

    cached.promise = (async () => {
      const mongoUri = process.env.MONGO_URI;

      if (mongoUri) {
        try {
          console.log('Connecting to MongoDB Atlas...');
          const conn = await mongoose.connect(mongoUri, opts);
          console.log(`MongoDB Atlas Connected: ${conn.connection.host}`);
          return conn;
        } catch (error) {
          console.warn(`MongoDB Atlas Connection Failed (${error.message}). Trying local MongoDB...`);
          // Additional hint for DNS issues
          console.warn('If this persists, ensure your network allows DNS SRV lookups or use a non‑SRV connection string (mongodb://).');
        }
      }

      try {
        const localUri = 'mongodb://127.0.0.1:27017/utilityBillsDB';
        const conn = await mongoose.connect(localUri, opts);
        console.log(`Local MongoDB Connected: ${conn.connection.host}`);
        return conn;
      } catch (error) {
        console.error(`Local MongoDB Connection Failed: ${error.message}`);
        throw error;
      }
    })();
  }

  try {
    cached.conn = await cached.promise;
  } catch (error) {
    cached.promise = null;
    throw error;
  }

  return cached.conn;
};

module.exports = connectDB;




