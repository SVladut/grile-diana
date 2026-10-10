(function initGrileFileStore(global) {
  "use strict";

  const ENDPOINT = "/api/state";
  const BROWSER_STORAGE_KEY = "grile-diana-state-v1";
  let state = null;
  let replaceQueue = Promise.resolve();

  const DEFAULT_STATE = Object.freeze({
    schema: "grile-diana-state",
    version: 1,
    revision: 0,
    updatedAt: null,
    progress: { version: 1, updatedAt: null, questions: {} },
    mistakes: { version: 1, updatedAt: null, questions: {} },
    flashcards: { version: 1, updatedAt: null, ratings: {}, session: null },
    notes: { version: 1, updatedAt: null, testRuns: 0, sections: {}, subchapters: {} },
    history: [],
    session: null
  });

  const hostname = global.location?.hostname;
  const useServerStorage = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

  function cloneJson(value) {
    if (value === null) return null;
    return JSON.parse(JSON.stringify(value));
  }

  function assertState(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Serverul a returnat o stare invalidă.");
    }
    if (value.schema !== "grile-diana-state" || value.version !== 1) {
      throw new Error("Versiunea stării returnate de server nu este compatibilă.");
    }
    if (!Number.isInteger(value.revision) || value.revision < 0) {
      throw new Error("Revizia stării returnate de server este invalidă.");
    }
    if (!value.progress || typeof value.progress !== "object" || !Array.isArray(value.history)) {
      throw new Error("Structura stării returnate de server este invalidă.");
    }
    return value;
  }

  function loadBrowserState() {
    const storedValue = global.localStorage.getItem(BROWSER_STORAGE_KEY);
    state = storedValue === null
      ? cloneJson(DEFAULT_STATE)
      : assertState(JSON.parse(storedValue));
    return cloneJson(state);
  }

  function readBrowserState() {
    const storedValue = global.localStorage.getItem(BROWSER_STORAGE_KEY);
    return storedValue === null
      ? cloneJson(DEFAULT_STATE)
      : assertState(JSON.parse(storedValue));
  }

  async function responseError(response) {
    let message = `Cererea a eșuat cu statusul ${response.status}.`;
    try {
      const payload = await response.json();
      if (payload?.error) message = payload.error;
      if (Array.isArray(payload?.details) && payload.details.length) {
        message += ` ${payload.details.join(" ")}`;
      }
    } catch {
      // Răspunsul de eroare nu este JSON; păstrăm mesajul bazat pe status.
    }
    return new Error(message);
  }

  async function requestState(url, options) {
    if (typeof global.fetch !== "function") {
      throw new Error("Browserul nu oferă API-ul fetch necesar pentru salvarea pe disc.");
    }
    const response = await global.fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      ...options
    });
    if (!response.ok) throw await responseError(response);
    return assertState(await response.json());
  }

  async function loadInitialState() {
    const loadedState = await requestState(ENDPOINT, { method: "GET" });
    state = cloneJson(loadedState);
    return cloneJson(state);
  }

  const ready = useServerStorage
    ? loadInitialState()
    : Promise.resolve().then(loadBrowserState);

  function getState() {
    return cloneJson(state);
  }

  function replace(nextState) {
    let serialized;
    try {
      serialized = JSON.stringify(nextState);
      if (serialized === undefined) throw new Error("Valoarea nu poate fi serializată.");
    } catch (error) {
      return Promise.reject(new Error(`Starea nu poate fi serializată ca JSON: ${error.message}`));
    }

    const operation = replaceQueue.then(async () => {
      await ready;
      if (!useServerStorage) {
        const currentState = readBrowserState();
        const submittedState = JSON.parse(serialized);
        if (currentState.revision !== submittedState.revision) {
          throw new Error("Starea a fost modificată în alt tab. Reîncarcă datele înainte de a salva din nou.");
        }
        const savedState = cloneJson({
          ...submittedState,
          revision: currentState.revision + 1,
          updatedAt: Date.now()
        });
        global.localStorage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(savedState));
        state = savedState;
        return cloneJson(state);
      }
      const savedState = await requestState(ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json;charset=utf-8" },
        body: serialized
      });
      state = cloneJson(savedState);
      return cloneJson(state);
    });
    replaceQueue = operation.catch(() => {});
    return operation;
  }

  global.GrileFileStore = Object.freeze({
    ready,
    getState,
    replace
  });
})(typeof window !== "undefined" ? window : globalThis);
