// utils/db.js — MongoDB connection
const mongoose = require("mongoose");
const logger = require("./logger");

const DEFAULT_LOCAL_URI = "mongodb://localhost:27017/dlnlite";

const isProduction = () => process.env.NODE_ENV === "production";
const isMemoryFallbackEnabled = () => Boolean(global.__DLN_MEMORY_DB__);
const isMongoConnected = () => mongoose.connection.readyState === 1;

const getMongoUri = () => {
  if (process.env.MONGO_URI) {
    return process.env.MONGO_URI;
  }

  return isProduction() ? null : DEFAULT_LOCAL_URI;
};

const getDatabaseMode = () => {
  if (isMongoConnected()) {
    return "mongodb";
  }

  if (isMemoryFallbackEnabled()) {
    return "memory";
  }

  return "unavailable";
};

const connectDB = async () => {
  const mongoUri = getMongoUri();

  if (!mongoUri) {
    global.__DLN_MEMORY_DB__ = true;
    logger.warn("MongoDB not configured. Set MONGO_URI to enable persistent storage; using in-memory metadata store instead.");
    return;
  }

  try {
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });
    global.__DLN_MEMORY_DB__ = false;
    logger.info(`✅ MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    global.__DLN_MEMORY_DB__ = true;
    logger.warn(`MongoDB unavailable, falling back to in-memory metadata store: ${error.message}`);
  }
};

module.exports = {
  connectDB,
  getDatabaseMode,
  isMemoryFallbackEnabled,
  isMongoConnected,
};
