// Application state, undo history and persistence.
//
// History is snapshot based: a plan holds at most a few hundred entities, so a
// structural clone per edit is cheap and cannot drift out of sync the way a
// command log can. Persistence degrades to memory when storage is unavailable,
// which happens in sandboxed frames.

const DB_NAME = 'floor-planner';
const STORE = 'state';
const KEY = 'current';
const HISTORY_LIMIT = 60;

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export class Store {
  constructor(project) {
    this.state = {
      project,
      selection: [],
      tool: 'select',
      view: { x: 0, y: 0, scale: 0.05 }, // scale = screen px per mm
      hover: null,
      snapEnabled: true,
      gridMm: 50,
      status: null,
      pending: null, // in-flight import
      lastHeal: null, // what the junction pass had to fix on the last edit
    };
    // Set by the app: a chance to tidy the document after every committed edit,
    // before it is versioned, drawn and saved. Junction healing runs here so
    // every one of the editor's edits gets it without having to remember to.
    this.afterEdit = null;
    this.past = [];
    this.future = [];
    // Where a live gesture — a drag, a slider — found the drawing. See `preview`.
    this.previewing = null;
    this.listeners = new Set();
    this.storageWorks = true;
    this.saveTimer = null;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(reason = 'change') {
    // A failing renderer must not take the edit pipeline down with it, or one
    // drawing bug turns into a stuck document.
    for (const fn of this.listeners) {
      try {
        fn(this.state, reason);
      } catch (err) {
        console.error('A view failed to update:', err);
      }
    }
  }

  get project() {
    return this.state.project;
  }

  /**
   * Remember where a live gesture started, before it changes anything.
   *
   * A drag or a slider has to alter the drawing as it goes, or there is nothing to
   * watch. But `edit` takes its undo snapshot when it is called, and by then the
   * gesture has already moved things — so undo restored the drawing as the gesture had
   * left it, not as it was found. That cost real work twice.
   *
   * Called on the first change of a gesture; the second call while one is open is
   * ignored, so it is safe to call from every pointer move.
   */
  preview() {
    if (!this.previewing) this.previewing = clone(this.state.project);
  }

  /**
   * Close a live gesture and put one entry in the history for the whole of it.
   *
   * The document is briefly wound back to where the gesture started so `edit` takes
   * its snapshot there, and then wound forward again — one edit, undoing to the state
   * before the gesture rather than to some point in the middle of it.
   */
  commit(label) {
    if (!this.previewing) return false;
    const after = this.state.project;
    this.state.project = this.previewing;
    this.previewing = null;
    // Nothing actually changed: leave the history alone rather than filling it with
    // entries for drags that went nowhere.
    if (JSON.stringify(after) === JSON.stringify(this.state.project)) {
      this.state.project = after;
      return false;
    }
    return this.edit(label, () => {
      this.state.project = after;
    });
  }

  /** Abandon a live gesture, putting the drawing back as it was found. */
  abandon() {
    if (!this.previewing) return false;
    this.state.project = this.previewing;
    this.previewing = null;
    this.emit('change');
    return true;
  }

  // Wraps a mutation so history, versioning and persistence stay consistent.
  edit(label, mutate) {
    const before = clone(this.state.project);
    const result = mutate(this.state.project);
    if (result === false) return false;
    if (this.afterEdit) {
      try {
        this.state.lastHeal = this.afterEdit(this.state.project, label) ?? null;
      } catch (err) {
        console.error('Tidying up after an edit failed:', err);
      }
    }
    this.past.push({ label, project: before });
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future.length = 0;
    for (const plan of this.state.project.plans) plan.version = (plan.version ?? 0) + 1;
    this.state.project.updatedAt = Date.now();
    this.emit('edit');
    this.scheduleSave();
    return true;
  }

  // Changes that must not land in history: view, tool, selection.
  set(partial, reason = 'ui') {
    Object.assign(this.state, partial);
    this.emit(reason);
  }

  replaceProject(project, { record = true, label = 'load' } = {}) {
    if (record) {
      this.past.push({ label, project: clone(this.state.project) });
      this.future.length = 0;
    }
    this.state.project = project;
    for (const plan of project.plans) plan.version = (plan.version ?? 0) + 1;
    this.state.selection = [];
    this.emit('replace');
    this.scheduleSave();
  }

  canUndo() {
    return this.past.length > 0;
  }
  canRedo() {
    return this.future.length > 0;
  }

  undo() {
    const entry = this.past.pop();
    if (!entry) return false;
    this.future.push({ label: entry.label, project: clone(this.state.project) });
    this.state.project = entry.project;
    for (const plan of this.state.project.plans) plan.version = (plan.version ?? 0) + 1;
    this.state.selection = [];
    this.emit('undo');
    this.scheduleSave();
    return true;
  }

  redo() {
    const entry = this.future.pop();
    if (!entry) return false;
    this.past.push({ label: entry.label, project: clone(this.state.project) });
    this.state.project = entry.project;
    for (const plan of this.state.project.plans) plan.version = (plan.version ?? 0) + 1;
    this.state.selection = [];
    this.emit('redo');
    this.scheduleSave();
    return true;
  }

  // ---- persistence ---------------------------------------------------

  scheduleSave() {
    if (!this.storageWorks) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save().catch(() => {
        this.storageWorks = false;
      });
    }, 700);
  }

  async save() {
    const db = await openDb();
    if (!db) {
      this.storageWorks = false;
      return;
    }
    await put(db, KEY, {
      project: this.state.project,
      savedAt: Date.now(),
    });
  }

  async load() {
    const db = await openDb();
    if (!db) {
      this.storageWorks = false;
      return null;
    }
    const record = await get(db, KEY);
    return record?.project ?? null;
  }

  async clearStorage() {
    const db = await openDb();
    if (db) await del(db, KEY);
  }
}

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let request;
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      request = indexedDB.open(DB_NAME, 1);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function put(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('write failed'));
    tx.onabort = () => reject(tx.error ?? new Error('write aborted'));
  });
}

function get(db, key) {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => resolve(null);
  });
}

function del(db, key) {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
