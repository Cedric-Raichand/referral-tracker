import { storeContract } from './contract.js';
import { createStore } from '../src/store/mongo.js';
import * as fakeDriver from './fake-mongodb.js';

storeContract('MongoDB (simulated driver)', () =>
  createStore({ mongoUri: 'mongodb://fake', mongoDb: 'test' }, fakeDriver),
);