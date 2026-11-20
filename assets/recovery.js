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
        let result;
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () =>
          reject(
            transaction.error ||
              Error("The browser checkpoint was interrupted."),
          );
        work(store, (value) => {
          result = value;
        });
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
        let index = 0;
        function saveNext() {
          if (index > pages.length + assets.length) return;
          const record =
            index === 0
              ? { metadata, options, pages: pages.length }
              : index <= pages.length
                ? pages[index - 1]
                : assets[index - pages.length - 1];
          // IndexedDB clones each value synchronously. Wait for the request
          // before cloning the next record, within the same atomic checkpoint.
          store.put(record, [id, index++]).onsuccess = saveNext;
        }
        store.delete(range(id)).onsuccess = saveNext;
      });
    },
    async available(id) {
      try {
        return !!(await transact("readonly", (store, complete) => {
          const request = store.getKey([id, 0]);
          request.onsuccess = () => complete(request.result);
        }));
      } catch {
        return false;
      }
    },
    async load(id) {
      return transact("readonly", (store, complete) => {
        let checkpoint = null,
          totalPages = 0;
        const request = store.openCursor(range(id));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            complete(checkpoint);
            return;
          }
          const index = cursor.key[1];
          const record = cursor.value;
          if (index === 0) {
            totalPages = record.pages;
            checkpoint = {
              options: record.options,
              project: { ...record.metadata, pages: [], assets: [] },
            };
          } else if (checkpoint) {
            const records =
              index <= totalPages
                ? checkpoint.project.pages
                : checkpoint.project.assets;
            records.push(record);
          }
          cursor.continue();
        };
      });
    },
    async remove(id) {
      try {
        await transact("readwrite", (store) => store.delete(range(id)));
      } catch {}
    },
  };
})();
