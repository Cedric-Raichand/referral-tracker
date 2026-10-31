const env = process.env;

export const config = {
  port: Number(env.PORT) || 3000,
  baseUrl: (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  adminPassword: env.ADMIN_PASSWORD || 'change-me',
  dbPath: env.DB_PATH || 'data/referrals.db',
  // Platform key -> label + where to send the new member
  platforms: {
    whatsapp: { label: 'WhatsApp group', url: env.WHATSAPP_URL || '' },
    snapchat: { label: 'Snapchat', url: env.SNAPCHAT_URL || '' },
    instagram: { label: 'Instagram', url: env.INSTAGRAM_URL || '' },
  },
};

export const platformKeys = Object.keys(config.platforms);