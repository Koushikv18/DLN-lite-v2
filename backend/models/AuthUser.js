const mongoose = require("mongoose");

const authUserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    role: { type: String, required: true, enum: ["shipper", "carrier", "customs"] },
    passwordHash: { type: String, required: true },
    passwordSalt: { type: String, required: true },
    sessionTokenHash: { type: String, default: null },
    sessionExpiresAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    fabricIdentity: {
      mspId: { type: String, default: null },
      certificate: { type: String, default: null },
      encryptedPrivateKey: { type: String, default: null },
    }
  },
  {
    timestamps: true,
    collection: "auth_users",
  }
);

const AuthUserModel = mongoose.model("AuthUser", authUserSchema);

const memoryStore = new Map();

const clone = (value) => JSON.parse(JSON.stringify(value));

const normalizeDoc = (doc) => ({
  name: doc.name,
  email: String(doc.email || "").toLowerCase(),
  role: doc.role,
  passwordHash: doc.passwordHash,
  passwordSalt: doc.passwordSalt,
  sessionTokenHash: doc.sessionTokenHash || null,
  sessionExpiresAt: doc.sessionExpiresAt || null,
  lastLoginAt: doc.lastLoginAt || null,
  fabricIdentity: doc.fabricIdentity || null,
  createdAt: doc.createdAt || new Date().toISOString(),
  updatedAt: doc.updatedAt || new Date().toISOString(),
});

const matchesQuery = (doc, query = {}) =>
  Object.entries(query).every(([key, value]) => {
    if (value && typeof value === "object" && "$in" in value) {
      return value.$in.includes(doc[key]);
    }
    return doc[key] === value;
  });

const useMemoryStore = () => global.__DLN_MEMORY_DB__ || mongoose.connection.readyState !== 1;

module.exports = {
  findOne(query = {}) {
    if (!useMemoryStore()) {
      return AuthUserModel.findOne(query);
    }

    const doc = Array.from(memoryStore.values()).find((entry) => matchesQuery(entry, query)) || null;
    return {
      lean: async () => clone(doc),
    };
  },

  async create(doc) {
    if (!useMemoryStore()) {
      return AuthUserModel.create(doc);
    }

    const normalized = normalizeDoc(doc);
    memoryStore.set(normalized.email, normalized);
    return clone(normalized);
  },

  async updateOne(query = {}, update = {}) {
    if (!useMemoryStore()) {
      return AuthUserModel.updateOne(query, update);
    }

    const doc = Array.from(memoryStore.values()).find((entry) => matchesQuery(entry, query));
    if (!doc) {
      return { matchedCount: 0, modifiedCount: 0 };
    }

    const patch = update.$set ? update.$set : update;
    Object.assign(doc, patch, { updatedAt: new Date().toISOString() });
    memoryStore.set(doc.email, doc);
    return { matchedCount: 1, modifiedCount: 1 };
  },
};
