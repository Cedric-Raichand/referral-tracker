import { config } from './config.js';

// MONGODB_URI set  -> MongoDB Atlas (data lives outside the server, survives restarts)
// MONGODB_URI empty -> local SQLite file (simple, good for development)
const store = config.mongoUri
  ? await (await import('./store/mongo.js')).createStore(config)
  : await (await import('./store/sqlite.js')).createStore(config);

export const storageKind = store.kind;
export const {
  createReferrer,
  getReferrerByUsername,
  getReferrerById,
  addReferral,
  getReferralById,
  setConfirmed,
  getReferralsByPlatform,
  setConfirmedMany,
  getLeaderboard,
  getReferralsFor,
} = store;