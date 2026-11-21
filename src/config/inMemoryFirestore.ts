/**
 * High-performance, zero-latency In-Memory Cloud Firestore Implementation
 * Used strictly in RAM for local unit tests without creating or touching files or cloud infrastructure.
 */

function deepClone<T>(obj: T): T {
  if (obj === undefined || obj === null) return obj;
  return JSON.parse(JSON.stringify(obj));
}

function applyNestedUpdate(target: Record<string, any>, keyPath: string, value: any): void {
  // Handle FieldValue.arrayUnion
  if (value && typeof value === 'object' && 'elements' in value && Array.isArray((value as any).elements)) {
    const existing = target[keyPath];
    const arr = Array.isArray(existing) ? [...existing] : [];
    for (const el of (value as any).elements) {
      if (!arr.includes(el)) arr.push(el);
    }
    target[keyPath] = arr;
    return;
  }

  // Handle dot notation e.g. 'wallet.credits'
  if (keyPath.includes('.')) {
    const parts = keyPath.split('.');
    let curr = target;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i]!;
      if (!curr[p] || typeof curr[p] !== 'object') {
        curr[p] = {};
      }
      curr = curr[p];
    }
    const lastKey = parts[parts.length - 1]!;
    curr[lastKey] = value;
    return;
  }

  target[keyPath] = value;
}

export class InMemoryDocumentSnapshot {
  constructor(
    public readonly id: string,
    private readonly _data: Record<string, any> | undefined,
    public readonly ref: InMemoryDocumentReference
  ) {}

  get exists(): boolean {
    return this._data !== undefined;
  }

  data(): Record<string, any> | undefined {
    return deepClone(this._data);
  }
}

export class InMemoryDocumentReference {
  constructor(
    private readonly store: Map<string, any>,
    public readonly path: string,
    public readonly id: string
  ) {}

  get ref(): InMemoryDocumentReference {
    return this;
  }

  collection(subCollectionName: string): InMemoryCollectionReference {
    return new InMemoryCollectionReference(this.store, `${this.path}/${subCollectionName}`);
  }

  async get(): Promise<InMemoryDocumentSnapshot> {
    const data = this.store.get(this.path);
    return new InMemoryDocumentSnapshot(this.id, data, this);
  }

  async set(data: Record<string, any>, options?: { merge?: boolean }): Promise<void> {
    const existing = this.store.get(this.path);
    if (options?.merge && existing && typeof existing === 'object') {
      const merged = deepClone(existing);
      for (const [k, v] of Object.entries(data)) {
        applyNestedUpdate(merged, k, v);
      }
      this.store.set(this.path, merged);
    } else {
      const fresh: Record<string, any> = {};
      for (const [k, v] of Object.entries(data)) {
        applyNestedUpdate(fresh, k, v);
      }
      this.store.set(this.path, fresh);
    }
  }

  async update(data: Record<string, any>): Promise<void> {
    const existing = this.store.get(this.path) || {};
    const updated = deepClone(existing);
    for (const [k, v] of Object.entries(data)) {
      applyNestedUpdate(updated, k, v);
    }
    this.store.set(this.path, updated);
  }

  async delete(): Promise<void> {
    this.store.delete(this.path);
  }
}

export interface FilterCondition {
  field: string;
  op: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'array-contains' | 'in';
  val: any;
}

export class InMemoryQuery {
  constructor(
    protected readonly store: Map<string, any>,
    protected readonly collectionPath: string,
    protected readonly filters: FilterCondition[] = [],
    protected readonly limitCount?: number
  ) {}

  where(field: string, op: any, val: any): InMemoryQuery {
    return new InMemoryQuery(
      this.store,
      this.collectionPath,
      [...this.filters, { field, op, val }],
      this.limitCount
    );
  }

  limit(count: number): InMemoryQuery {
    return new InMemoryQuery(this.store, this.collectionPath, this.filters, count);
  }

  async get(): Promise<{
    empty: boolean;
    size: number;
    docs: InMemoryDocumentSnapshot[];
  }> {
    const prefix = `${this.collectionPath}/`;
    const docs: InMemoryDocumentSnapshot[] = [];

    for (const [docPath, rawData] of this.store.entries()) {
      if (!docPath.startsWith(prefix)) continue;
      const relative = docPath.slice(prefix.length);
      if (relative.includes('/')) continue;

      const docId = relative;
      const docRef = new InMemoryDocumentReference(this.store, docPath, docId);

      let matches = true;
      for (const filter of this.filters) {
        const val = rawData[filter.field];
        if (filter.op === '==') {
          if (val !== filter.val) matches = false;
        } else if (filter.op === '!=') {
          if (val === filter.val) matches = false;
        } else if (filter.op === 'array-contains') {
          if (!Array.isArray(val) || !val.includes(filter.val)) matches = false;
        } else if (filter.op === 'in') {
          if (!Array.isArray(filter.val) || !filter.val.includes(val)) matches = false;
        }
        if (!matches) break;
      }

      if (matches) {
        docs.push(new InMemoryDocumentSnapshot(docId, rawData, docRef));
        if (this.limitCount && docs.length >= this.limitCount) {
          break;
        }
      }
    }

    return {
      empty: docs.length === 0,
      size: docs.length,
      docs,
    };
  }
}

export class InMemoryCollectionReference extends InMemoryQuery {
  constructor(store: Map<string, any>, collectionPath: string) {
    super(store, collectionPath, [], undefined);
  }

  get id(): string {
    const parts = this.collectionPath.split('/');
    return parts[parts.length - 1]!;
  }

  get path(): string {
    return this.collectionPath;
  }

  doc(docId?: string): InMemoryDocumentReference {
    const id = docId || `doc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    return new InMemoryDocumentReference(this.store, `${this.collectionPath}/${id}`, id);
  }
}

export class InMemoryTransaction {
  constructor() {}

  async get(docRef: any): Promise<any> {
    return docRef.get();
  }

  set(docRef: any, data: any, options?: any): InMemoryTransaction {
    docRef.set(data, options);
    return this;
  }

  update(docRef: any, data: any): InMemoryTransaction {
    docRef.update(data);
    return this;
  }

  delete(docRef: any): InMemoryTransaction {
    docRef.delete();
    return this;
  }
}

export class InMemoryWriteBatch {
  private operations: Array<() => Promise<void> | void> = [];

  constructor() {}

  set(docRef: any, data: any, options?: any): InMemoryWriteBatch {
    this.operations.push(() => docRef.set(data, options));
    return this;
  }

  update(docRef: any, data: any): InMemoryWriteBatch {
    this.operations.push(() => docRef.update(data));
    return this;
  }

  delete(docRef: any): InMemoryWriteBatch {
    this.operations.push(() => docRef.delete());
    return this;
  }

  async commit(): Promise<void> {
    for (const op of this.operations) {
      await op();
    }
  }
}

export class InMemoryFirestore {
  private readonly store = new Map<string, any>();

  settings(_settings: any): void {}

  collection(collectionPath: string): InMemoryCollectionReference {
    return new InMemoryCollectionReference(this.store, collectionPath);
  }

  async runTransaction<T>(updateFunction: (transaction: InMemoryTransaction) => Promise<T>): Promise<T> {
    const t = new InMemoryTransaction();
    return updateFunction(t);
  }

  batch(): InMemoryWriteBatch {
    return new InMemoryWriteBatch();
  }

  clear(): void {
    this.store.clear();
  }
}

export const inMemoryDb = new InMemoryFirestore();
export default inMemoryDb;
