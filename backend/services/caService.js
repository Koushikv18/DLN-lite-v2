const FabricCAServices = require('fabric-ca-client');
const { Wallets } = require('fabric-network');
const crypto = require('crypto');
const AuthUser = require('../models/AuthUser');
require('dotenv').config();

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.createHash('sha256').update('default-dev-key').digest('hex'); // 32 bytes hex string
const ENCRYPTION_ALGO = 'aes-256-gcm';

// -----------------------------------------------------------------------------
// MongoDB Wallet Adapter
// -----------------------------------------------------------------------------
class MongoWallet {
  async get(userId) {
    const user = await AuthUser.findOne({ email: userId });
    if (!user || !user.fabricIdentity || !user.fabricIdentity.certificate) {
      return undefined;
    }

    const { mspId, certificate, encryptedPrivateKey } = user.fabricIdentity;

    const parts = encryptedPrivateKey.split(':');
    if (parts.length !== 3) {
      throw new Error("Invalid encrypted key format. Expected iv:authTag:encrypted");
    }
    
    const storedIv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encryptedText = Buffer.from(parts[2], 'hex');

    const decipherGcm = crypto.createDecipheriv(ENCRYPTION_ALGO, Buffer.from(ENCRYPTION_KEY, 'hex'), storedIv);
    decipherGcm.setAuthTag(authTag);
    let privateKey = decipherGcm.update(encryptedText, undefined, 'utf8');
    privateKey += decipherGcm.final('utf8');

    return {
      credentials: {
        certificate,
        privateKey,
      },
      mspId,
      type: 'X.509',
    };
  }

  async put(userId, identity) {
    const iv = crypto.randomBytes(12); // 96-bit IV is standard for GCM
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGO, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    
    let encrypted = cipher.update(identity.credentials.privateKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    
    const encryptedPrivateKey = `${iv.toString('hex')}:${authTag}:${encrypted}`;

    await AuthUser.updateOne(
      { email: userId },
      {
        $set: {
          fabricIdentity: {
            mspId: identity.mspId,
            certificate: identity.credentials.certificate,
            encryptedPrivateKey,
          }
        }
      }
    );
  }
}

// Global in-memory admin wallet for the CA Admin (since the admin isn't an AuthUser in Mongo)
let adminWallet = null;

async function getAdminWallet() {
  if (!adminWallet) {
    adminWallet = await Wallets.newInMemoryWallet();
  }
  return adminWallet;
}

async function enrollCAAdmin() {
  try {
    const wallet = await getAdminWallet();
    const ca = new FabricCAServices('http://localhost:7054', { verify: false }, 'ca-org1');
    const enrollment = await ca.enroll({ enrollmentID: 'admin', enrollmentSecret: 'adminpw' });
    
    const identity = {
      credentials: {
        certificate: enrollment.certificate,
        privateKey: enrollment.key.toBytes(),
      },
      mspId: 'Org1MSP',
      type: 'X.509',
    };
    
    await wallet.put('ca-admin', identity);
    console.log('✅ Successfully enrolled CA admin and imported it into memory wallet');
  } catch (error) {
    console.error(`Failed to enroll CA admin: ${error}`);
  }
}

async function registerAndEnrollUser(userId, orgRole) {
  try {
    const ca = new FabricCAServices('http://localhost:7054', { verify: false }, 'ca-org1');
    const wallet = await getAdminWallet();
    let adminIdentity = await wallet.get('ca-admin');
    
    if (!adminIdentity) {
      console.log('An identity for the admin user "admin" does not exist in the wallet. Enrolling admin now...');
      await enrollCAAdmin();
      adminIdentity = await wallet.get('ca-admin');
    }

    const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);
    const adminUser = await provider.getUserContext(adminIdentity, 'ca-admin');

    // Register the user
    const secret = await ca.register({
      affiliation: 'org1.department1',
      enrollmentID: userId,
      role: 'client',
      attrs: [{ name: 'role', value: orgRole, ecert: true }],
    }, adminUser);

    // Enroll the user
    const enrollment = await ca.enroll({
      enrollmentID: userId,
      enrollmentSecret: secret,
      attr_reqs: [{ name: 'role', optional: false }]
    });

    const identity = {
      credentials: {
        certificate: enrollment.certificate,
        privateKey: enrollment.key.toBytes(),
      },
      mspId: 'Org1MSP',
      type: 'X.509',
    };

    const userWallet = new MongoWallet();
    await userWallet.put(userId, identity);
    console.log(`✅ Successfully registered and enrolled user ${userId} and saved to MongoDB wallet`);
    return identity;
  } catch (error) {
    console.error(`Failed to register user ${userId}: ${error}`);
    throw error;
  }
}

module.exports = {
  enrollCAAdmin,
  registerAndEnrollUser,
  MongoWallet
};
