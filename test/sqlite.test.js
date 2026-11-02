import { storeContract } from './contract.js';
import { createStore } from '../src/store/sqlite.js';

storeContract('SQLite', () => createStore({ dbPath: ':memory:' }));