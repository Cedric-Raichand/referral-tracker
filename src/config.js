const env = process.env;

export const config = {
  port: Number(env.PORT) || 3000,
  // The admin site is a separate server. Locally give it its own ADMIN_PORT; on a host it uses the host's PORT.
  adminPort: Number(env.ADMIN_PORT) || Number(env.PORT) || 3001,
  baseUrl: (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  siteName: env.SITE_NAME || 'Join our community',
  adminPassword: env.ADMIN_PASSWORD || 'change-me',
  // If MONGODB_URI is set the app stores data in MongoDB Atlas, otherwise in a local SQLite file.
  mongoUri: env.MONGODB_URI || '',
  mongoDb: env.MONGODB_DB || 'referral_tracker',
  dbPath: env.DB_PATH || 'data/referrals.db',
  // Platform key -> label, where to send the new member, and what we ask them for.
  // contact 'phone' = phone number (matches the WhatsApp member list)
  // contact 'username' = their handle (matches the Snapchat friends / Instagram followers list)
  platforms: {
    whatsapp: { label: 'WhatsApp group', url: env.WHATSAPP_URL || '', contact: 'phone' },
    snapchat: { label: 'Snapchat', url: env.SNAPCHAT_URL || '', contact: 'username' },
    instagram: { label: 'Instagram', url: env.INSTAGRAM_URL || '', contact: 'username' },
  },
};

export const platformKeys = Object.keys(config.platforms);