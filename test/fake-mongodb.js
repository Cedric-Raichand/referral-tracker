let counter = 0;

export class ObjectId {
  constructor(hex) {
    this.hex = hex ? String(hex) : (++counter).toString(16).padStart(24, '0');
  }
  toString() { return this.hex; }
}

const dupError = () => Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
const get = (doc, path) => (path === '_id' ? String(doc._id) : doc[path]);
const matches = (doc, filter) =>
  Object.entries(filter).every(([k, v]) =>
    v && typeof v === 'object' && v.$in
      ? v.$in.map(String).includes(String(get(doc, k)))
      : String(get(doc, k)) === String(v),
  );

class Cursor {
  constructor(docs) { this.docs = docs; }
  sort(spec) {
    const keys = Object.entries(spec);
    this.docs = [...this.docs].sort((a, b) => {
      for (const [k, dir] of keys) {
        const x = String(get(a, k)); const y = String(get(b, k));
        if (x !== y) return (x < y ? -1 : 1) * dir;
      }
      return 0;
    });
    return this;
  }
  async toArray() { return this.docs.map((d) => ({ ...d })); }
}

class Collection {
  constructor() { this.docs = []; this.unique = []; }
  async createIndex(spec, opts = {}) { if (opts.unique) this.unique.push(Object.keys(spec)); }
  async insertOne(doc) {
    for (const keys of this.unique) {
      if (this.docs.some((d) => keys.every((k) => d[k] === doc[k]))) throw dupError();
    }
    const saved = { ...doc, _id: new ObjectId() };
    this.docs.push(saved);
    return { insertedId: saved._id };
  }
  async findOne(filter) {
    const doc = this.docs.find((d) => matches(d, filter));
    return doc ? { ...doc } : null;
  }
  find(filter = {}) { return new Cursor(this.docs.filter((d) => matches(d, filter))); }
  async updateOne(filter, update, opts = {}) {
    const doc = this.docs.find((d) => matches(d, filter));
    if (!doc && opts.upsert) {
      this.docs.push({ _id: filter._id, ...update.$set });
      return { matchedCount: 0, upsertedCount: 1 };
    }
    if (!doc) return { matchedCount: 0 };
    Object.assign(doc, update.$set);
    return { matchedCount: 1 };
  }
  async updateMany(filter, update) {
    const found = this.docs.filter((d) => matches(d, filter));
    for (const d of found) Object.assign(d, update.$set);
    return { matchedCount: found.length };
  }
  // Supports exactly the $group stage our leaderboard uses.
  aggregate(pipeline) {
    const group = pipeline[0].$group;
    const out = new Map();
    for (const d of this.docs) {
      const id = {};
      for (const [name, ref] of Object.entries(group._id)) id[name] = d[ref.slice(1)];
      const key = JSON.stringify(id);
      const entry = out.get(key) || { _id: id, n: 0, c: 0 };
      entry.n += 1;
      entry.c += d[group.c.$sum.$cond[0].slice(1)] ? 1 : 0;
      out.set(key, entry);
    }
    return new Cursor([...out.values()]);
  }
}

export class MongoClient {
  constructor() { this.dbs = new Map(); }
  async connect() {}
  db(name) {
    if (!this.dbs.has(name)) {
      const collections = new Map();
      this.dbs.set(name, {
        collection: (c) => {
          if (!collections.has(c)) collections.set(c, new Collection());
          return collections.get(c);
        },
      });
    }
    return this.dbs.get(name);
  }
}