"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "file-store.js"), "utf8");

function createStore(hostname, storage, fetch = async () => {
  throw new Error("fetch should not be called");
}) {
  const window = {
    location: { hostname },
    localStorage: {
      getItem(key) {
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        storage.set(key, value);
      }
    },
    fetch
  };
  vm.runInNewContext(source, { window });
  return window.GrileFileStore;
}

test("public-host storage persists state in the browser without calling the API", async () => {
  const storage = new Map();
  const store = createStore("svladut.github.io", storage);
  await store.ready;

  const initialState = store.getState();
  assert.equal(initialState.revision, 0);
  assert.equal(initialState.history.length, 0);

  const savedState = await store.replace({
    ...initialState,
    progress: {
      ...initialState.progress,
      questions: { "1.01-1": { status: "correct", attempts: 1, correctAttempts: 1, wrongAttempts: 0 } }
    }
  });
  assert.equal(savedState.revision, 1);

  const reloadedStore = createStore("svladut.github.io", storage);
  await reloadedStore.ready;
  assert.equal(reloadedStore.getState().progress.questions["1.01-1"].status, "correct");
});

test("browser storage rejects stale writes from another tab", async () => {
  const storage = new Map();
  const firstTab = createStore("svladut.github.io", storage);
  const secondTab = createStore("svladut.github.io", storage);
  await Promise.all([firstTab.ready, secondTab.ready]);

  const staleState = secondTab.getState();
  await firstTab.replace(firstTab.getState());
  await assert.rejects(secondTab.replace(staleState), /modificată în alt tab/);
});

test("localhost continues to load state from the server API", async () => {
  const serverState = {
    schema: "grile-diana-state",
    version: 1,
    revision: 0,
    updatedAt: null,
    progress: { version: 1, updatedAt: null, questions: {} },
    history: []
  };
  const fetchCalls = [];
  const store = createStore("127.0.0.1", new Map(), async (url, options) => {
    fetchCalls.push({ url, options });
    return { ok: true, json: async () => serverState };
  });
  await store.ready;

  assert.equal(store.getState().revision, 0);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "/api/state");
  assert.equal(fetchCalls[0].options.method, "GET");
});
