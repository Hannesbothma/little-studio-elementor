(() => {
  "use strict";

  async function database() {
    return new Promise((resolve, reject) => {
      const { ajax, userId } = window.LSE_CONFIG;
      const request = indexedDB.open("lse-import:" + ajax + ":" + userId, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("checkpoints");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function transact(mode, work) {
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction("checkpoints", mode);
        const store = transaction.objectStore("checkpoints");
        const result = work(store);
        transaction.oncomplete = () => resolve(result?.result);
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  }

  const range = (id) =>
    IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);

  window.LSERecovery = {
    async save(id, project, options) {
      const { pages, assets, ...metadata } = project;
      await transact("readwrite", (store) => {
        store.delete(range(id));
        store.put({ metadata, options, pages: pages.length }, [id, 0]);
        let index = 0;
        for (const record of pages) store.put(record, [id, ++index]);
        for (const record of assets) store.put(record, [id, ++index]);
      });
    },
    async available(id) {
      try {
        return !!(await transact("readonly", (store) => store.getKey([id, 0])));
      } catch {
        return false;
      }
    },
    async load(id) {
      const [checkpoint, ...records] = await transact("readonly", (store) =>
        store.getAll(range(id)),
      );
      if (!checkpoint) return null;
      return {
        options: checkpoint.options,
        project: {
          ...checkpoint.metadata,
          pages: records.slice(0, checkpoint.pages),
          assets: records.slice(checkpoint.pages),
        },
      };
    },
    async remove(id) {
      try {
        await transact("readwrite", (store) => store.delete(range(id)));
      } catch {}
    },
  };
})();
