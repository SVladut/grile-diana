"use strict";

const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const crypto = require("node:crypto");

const ROOT_DIR = path.resolve(__dirname);
const DEFAULT_STATE_FILE = path.join(ROOT_DIR, "data", "diana-state.json");
const STATE_FILE = process.env.GRILE_STATE_FILE
  ? path.resolve(ROOT_DIR, process.env.GRILE_STATE_FILE)
  : DEFAULT_STATE_FILE;
const STATE_DIR = path.dirname(STATE_FILE);
const HOST = "127.0.0.1";
const DEFAULT_PORT = 3001;
const MAX_BODY_MEGABYTES = 64;
const MAX_BODY_BYTES = MAX_BODY_MEGABYTES * 1024 * 1024;

const DEFAULT_STATE = Object.freeze({
  schema: "grile-diana-state",
  version: 1,
  revision: 0,
  updatedAt: null,
  progress: {
    version: 1,
    updatedAt: null,
    questions: {}
  },
  mistakes: {
    version: 1,
    updatedAt: null,
    questions: {}
  },
  flashcards: {
    version: 1,
    updatedAt: null,
    ratings: {},
    session: null
  },
  notes: {
    version: 1,
    updatedAt: null,
    testRuns: 0,
    sections: {},
    subchapters: {}
  },
  history: [],
  session: null
});

const MIME_TYPES = new Map([
  [".html", "text/html;charset=utf-8"],
  [".css", "text/css;charset=utf-8"],
  [".js", "text/javascript;charset=utf-8"],
  [".json", "application/json;charset=utf-8"],
  [".sql", "text/plain;charset=utf-8"],
  [".txt", "text/plain;charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"]
]);

let currentState = null;
let rootRealPath = ROOT_DIR;
let writeQueue = Promise.resolve();

class HttpError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

function parsePort(rawValue) {
  if (rawValue === undefined || rawValue === "") return DEFAULT_PORT;
  const port = Number(rawValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT trebuie să fie un număr întreg între 1 și 65535.");
  }
  return port;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isTimestamp(value) {
  return value === null || (Number.isFinite(value) && value >= 0);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function validateState(state) {
  const errors = [];
  const add = message => {
    if (errors.length < 25) errors.push(message);
  };

  if (!isPlainObject(state)) return ["Starea trebuie să fie un obiect JSON."];
  if (state.schema !== "grile-diana-state") add("Câmpul schema trebuie să fie «grile-diana-state».");
  if (state.version !== 1) add("Versiunea stării trebuie să fie 1.");
  if (!isNonNegativeInteger(state.revision)) add("revision trebuie să fie un număr întreg pozitiv sau zero.");
  if (!isTimestamp(state.updatedAt)) add("updatedAt trebuie să fie null sau un timestamp valid.");

  if (!isPlainObject(state.progress)) {
    add("progress trebuie să fie un obiect.");
  } else {
    if (state.progress.version !== 1) add("progress.version trebuie să fie 1.");
    if (!isTimestamp(state.progress.updatedAt)) add("progress.updatedAt trebuie să fie null sau un timestamp valid.");
    if (!isPlainObject(state.progress.questions)) {
      add("progress.questions trebuie să fie un obiect.");
    } else {
      const questionEntries = Object.entries(state.progress.questions);
      if (questionEntries.length > 25000) add("progress.questions depășește limita de 25000 de întrebări.");
      for (const [questionId, record] of questionEntries) {
        if (!questionId || questionId.length > 250) {
          add("Un identificator din progress.questions este invalid.");
          break;
        }
        if (!isPlainObject(record)) {
          add(`Progresul pentru ${questionId} trebuie să fie un obiect.`);
          break;
        }
        if (!new Set(["correct", "wrong"]).has(record.status)) {
          add(`Statusul progresului pentru ${questionId} este invalid.`);
          break;
        }
        for (const field of ["attempts", "correctAttempts", "wrongAttempts"]) {
          if (!isNonNegativeInteger(record[field])) {
            add(`${field} pentru ${questionId} trebuie să fie un număr întreg pozitiv sau zero.`);
            break;
          }
        }
      }
    }
  }

  if (state.mistakes !== undefined) {
    if (!isPlainObject(state.mistakes)) {
      add("mistakes trebuie să fie un obiect.");
    } else {
      if (state.mistakes.version !== 1) add("mistakes.version trebuie să fie 1.");
      if (!isTimestamp(state.mistakes.updatedAt)) add("mistakes.updatedAt trebuie să fie null sau un timestamp valid.");
      if (!isPlainObject(state.mistakes.questions)) {
        add("mistakes.questions trebuie să fie un obiect.");
      } else {
        const mistakeEntries = Object.entries(state.mistakes.questions);
        if (mistakeEntries.length > 25000) add("mistakes.questions depășește limita de 25000 de întrebări.");
        for (const [questionId, record] of mistakeEntries) {
          if (!questionId || questionId.length > 250 || !isPlainObject(record)) {
            add("O înregistrare din mistakes.questions este invalidă.");
            break;
          }
          if (record.status !== "active" && record.status !== "mastered") {
            add(`Statusul greșelii pentru ${questionId} este invalid.`);
            break;
          }
          if (!Number.isInteger(record.wrongAttempts) || record.wrongAttempts < 1) {
            add(`wrongAttempts pentru ${questionId} trebuie să fie un număr întreg pozitiv.`);
            break;
          }
          for (const field of ["firstWrongAt", "lastWrongAt", "resolvedAt"]) {
            if (!isTimestamp(record[field])) {
              add(`${field} pentru ${questionId} trebuie să fie null sau un timestamp valid.`);
              break;
            }
          }
        }
      }
    }
  }

  if (state.flashcards !== undefined) {
    if (!isPlainObject(state.flashcards)) {
      add("flashcards trebuie să fie un obiect.");
    } else {
      if (state.flashcards.version !== 1) add("flashcards.version trebuie să fie 1.");
      if (!isTimestamp(state.flashcards.updatedAt)) add("flashcards.updatedAt trebuie să fie null sau un timestamp valid.");
      if (!isPlainObject(state.flashcards.ratings)) {
        add("flashcards.ratings trebuie să fie un obiect.");
      } else {
        const ratingEntries = Object.entries(state.flashcards.ratings);
        if (ratingEntries.length > 20000) add("flashcards.ratings depășește limita de 20000 de carduri.");
        for (const [cardId, record] of ratingEntries) {
          if (!cardId || cardId.length > 250 || !isPlainObject(record)) {
            add("O înregistrare din flashcards.ratings este invalidă.");
            break;
          }
          if (!Number.isInteger(record.confidence) || record.confidence < 1 || record.confidence > 5) {
            add(`confidence pentru flashcardul ${cardId} trebuie să fie între 1 și 5.`);
            break;
          }
          if (!Number.isInteger(record.reviews) || record.reviews < 1) {
            add(`reviews pentru flashcardul ${cardId} trebuie să fie un număr întreg pozitiv.`);
            break;
          }
          for (const field of ["firstSeenAt", "lastReviewedAt", "nextDueAt"]) {
            if (!isTimestamp(record[field]) || record[field] === null) {
              add(`${field} pentru flashcardul ${cardId} trebuie să fie un timestamp valid.`);
              break;
            }
          }
          if (!Number.isFinite(record.intervalMinutes) || record.intervalMinutes <= 0) {
            add(`intervalMinutes pentru flashcardul ${cardId} trebuie să fie pozitiv.`);
            break;
          }
        }
      }

      const session = state.flashcards.session;
      if (session !== null) {
        if (!isPlainObject(session)
          || session.version !== 1
          || typeof session.id !== "string"
          || !session.id
          || !["active", "completed"].includes(session.status)
          || !Array.isArray(session.deckIds)
          || !Array.isArray(session.queue)) {
          add("flashcards.session este invalidă.");
        } else {
          if (!isNonNegativeInteger(session.targetReviews) || session.targetReviews < 1) add("flashcards.session.targetReviews este invalid.");
          if (!isNonNegativeInteger(session.reviewedCount)) add("flashcards.session.reviewedCount este invalid.");
          if (session.currentCardId !== null && (typeof session.currentCardId !== "string" || !session.currentCardId)) {
            add("flashcards.session.currentCardId este invalid.");
          }
        }
      }
    }
  }

  if (state.notes !== undefined) {
    if (!isPlainObject(state.notes)) {
      add("notes trebuie să fie un obiect.");
    } else {
      if (state.notes.version !== 1) add("notes.version trebuie să fie 1.");
      if (!isTimestamp(state.notes.updatedAt)) add("notes.updatedAt trebuie să fie null sau un timestamp valid.");
      if (!isNonNegativeInteger(state.notes.testRuns)) add("notes.testRuns trebuie să fie un număr întreg pozitiv sau zero.");
      if (!isPlainObject(state.notes.sections)) {
        add("notes.sections trebuie să fie un obiect.");
      } else {
        const sectionEntries = Object.entries(state.notes.sections);
        if (sectionEntries.length > 5000) add("notes.sections depășește limita de 5000 de secțiuni.");
        for (const [sectionId, record] of sectionEntries) {
          if (!sectionId || sectionId.length > 250 || !isPlainObject(record)) {
            add("O înregistrare din notes.sections este invalidă.");
            break;
          }
          for (const field of ["viewCount", "testAttempts", "correctAnswers", "totalAnswers"]) {
            if (!isNonNegativeInteger(record[field])) {
              add(`${field} pentru secțiunea ${sectionId} trebuie să fie un număr întreg pozitiv sau zero.`);
              break;
            }
          }
          for (const field of ["firstViewedAt", "lastViewedAt", "completedAt", "lastTestedAt"]) {
            if (!isTimestamp(record[field])) {
              add(`${field} pentru secțiunea ${sectionId} trebuie să fie null sau un timestamp valid.`);
              break;
            }
          }
          if (!Number.isFinite(record.bestPercentage) || record.bestPercentage < 0 || record.bestPercentage > 100) {
            add(`bestPercentage pentru secțiunea ${sectionId} trebuie să fie între 0 și 100.`);
          }
          if (record.lastPercentage !== null
            && (!Number.isFinite(record.lastPercentage) || record.lastPercentage < 0 || record.lastPercentage > 100)) {
            add(`lastPercentage pentru secțiunea ${sectionId} trebuie să fie null sau între 0 și 100.`);
          }
        }
      }
      if (!isPlainObject(state.notes.subchapters)) {
        add("notes.subchapters trebuie să fie un obiect.");
      } else {
        const subchapterEntries = Object.entries(state.notes.subchapters);
        if (subchapterEntries.length > 500) add("notes.subchapters depășește limita de 500 de subcapitole.");
        for (const [subchapterId, record] of subchapterEntries) {
          if (!subchapterId || subchapterId.length > 250 || !isPlainObject(record)) {
            add("O înregistrare din notes.subchapters este invalidă.");
            break;
          }
          for (const field of ["testAttempts", "correctAnswers", "totalAnswers"]) {
            if (!isNonNegativeInteger(record[field])) {
              add(`${field} pentru subcapitolul ${subchapterId} trebuie să fie un număr întreg pozitiv sau zero.`);
              break;
            }
          }
          if (!Number.isFinite(record.bestPercentage) || record.bestPercentage < 0 || record.bestPercentage > 100) {
            add(`bestPercentage pentru subcapitolul ${subchapterId} trebuie să fie între 0 și 100.`);
          }
          if (record.lastPercentage !== null
            && (!Number.isFinite(record.lastPercentage) || record.lastPercentage < 0 || record.lastPercentage > 100)) {
            add(`lastPercentage pentru subcapitolul ${subchapterId} trebuie să fie null sau între 0 și 100.`);
          }
          if (!isTimestamp(record.lastTestedAt)) {
            add(`lastTestedAt pentru subcapitolul ${subchapterId} trebuie să fie null sau un timestamp valid.`);
          }
        }
      }
    }
  }

  if (!Array.isArray(state.history)) {
    add("history trebuie să fie un array.");
  } else {
    if (state.history.length > 5000) add("history depășește limita de 5000 de teste.");
    const historyIds = new Set();
    for (const entry of state.history) {
      if (!isPlainObject(entry)) {
        add("Fiecare element din history trebuie să fie un obiect.");
        break;
      }
      if (typeof entry.id !== "string" || !entry.id || entry.id.length > 250) {
        add("Fiecare test din history trebuie să aibă un id valid.");
        break;
      }
      if (historyIds.has(entry.id)) {
        add(`Testul ${entry.id} apare de mai multe ori în history.`);
        break;
      }
      historyIds.add(entry.id);
      if (!["practice", "exam", "mistakes"].includes(entry.mode)) {
        add(`Modul testului ${entry.id} este invalid.`);
        break;
      }
      for (const field of ["totalQuestions", "correctCount", "score", "maxScore"]) {
        if (!Number.isFinite(entry[field]) || entry[field] < 0) {
          add(`${field} pentru testul ${entry.id} trebuie să fie un număr pozitiv sau zero.`);
          break;
        }
      }
    }
  }

  if (state.session !== null) {
    const session = state.session;
    if (!isPlainObject(session)) {
      add("session trebuie să fie null sau un obiect.");
    } else {
      if (session.version !== 1) add("session.version trebuie să fie 1.");
      if (typeof session.id !== "string" || !session.id || session.id.length > 250) add("session.id este invalid.");
      if (!["practice", "exam", "mistakes"].includes(session.mode)) add("session.mode este invalid.");
      if (session.status !== "active" && session.status !== "completed") add("session.status este invalid.");
      if (!Array.isArray(session.questionIds) || !session.questionIds.length || session.questionIds.length > 10000) {
        add("session.questionIds trebuie să conțină între 1 și 10000 de identificatori.");
      } else if (session.questionIds.some(id => typeof id !== "string" || !id || id.length > 250)) {
        add("session.questionIds conține un identificator invalid.");
      } else if (new Set(session.questionIds).size !== session.questionIds.length) {
        add("session.questionIds nu poate conține duplicate.");
      }
      if (!isPlainObject(session.answers)) add("session.answers trebuie să fie un obiect.");
      if (!isTimestamp(session.createdAt) || session.createdAt === null) add("session.createdAt trebuie să fie un timestamp valid.");
      if (!isTimestamp(session.updatedAt) || session.updatedAt === null) add("session.updatedAt trebuie să fie un timestamp valid.");
      if (!isTimestamp(session.completedAt)) add("session.completedAt trebuie să fie null sau un timestamp valid.");
      if (session.status === "completed" && !isPlainObject(session.result)) add("O sesiune finalizată trebuie să conțină result.");
    }
  }

  return errors;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

async function atomicWriteState(state) {
  const suffix = `${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const temporaryFile = path.join(STATE_DIR, `.diana-state-${suffix}.tmp`);
  const contents = `${JSON.stringify(state, null, 2)}\n`;
  let handle = null;

  try {
    handle = await fsp.open(temporaryFile, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fsp.rename(temporaryFile, STATE_FILE);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fsp.unlink(temporaryFile).catch(error => {
      if (error.code !== "ENOENT") console.warn("Nu s-a putut șterge fișierul temporar:", error.message);
    });
  }
}

function enqueueWrite(task) {
  const operation = writeQueue.then(task, task);
  writeQueue = operation.catch(() => {});
  return operation;
}

async function initializeState() {
  await fsp.mkdir(STATE_DIR, { recursive: true });
  rootRealPath = await fsp.realpath(ROOT_DIR);

  try {
    const raw = await fsp.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const errors = validateState(parsed);
    if (errors.length) throw new Error(`Starea inițială este invalidă: ${errors.join(" ")}`);
    currentState = parsed;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    currentState = cloneJson(DEFAULT_STATE);
    await atomicWriteState(currentState);
  }
}

function sendJson(response, statusCode, value, extraHeaders = {}) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(statusCode, {
    "Content-Type": "application/json;charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders
  });
  response.end(body);
}

function sendText(response, statusCode, message, extraHeaders = {}) {
  const body = `${message}\n`;
  response.writeHead(statusCode, {
    "Content-Type": "text/plain;charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders
  });
  response.end(body);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(request.headers["content-length"] || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      request.resume();
      reject(new HttpError(413, `Corpul cererii depășește limita de ${MAX_BODY_MEGABYTES} MB.`));
      return;
    }

    const chunks = [];
    let received = 0;
    let tooLarge = false;

    request.on("data", chunk => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    request.on("end", () => {
      if (tooLarge) {
        reject(new HttpError(413, `Corpul cererii depășește limita de ${MAX_BODY_MEGABYTES} MB.`));
        return;
      }
      if (!received) {
        reject(new HttpError(400, "Corpul JSON lipsește."));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "Corpul cererii nu este JSON valid."));
      }
    });
    request.on("error", reject);
    request.on("aborted", () => reject(new HttpError(400, "Cererea a fost întreruptă.")));
  });
}

async function handleStateApi(request, response) {
  if (request.method === "GET") {
    await writeQueue;
    sendJson(response, 200, currentState);
    return;
  }

  if (request.method !== "PUT") {
    sendJson(response, 405, { error: "Metodă nepermisă." }, { Allow: "GET, PUT" });
    return;
  }

  const contentType = String(request.headers["content-type"] || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    request.resume();
    throw new HttpError(415, "PUT /api/state acceptă doar application/json.");
  }

  const submittedState = await readJsonBody(request);
  const validationErrors = validateState(submittedState);
  if (validationErrors.length) {
    throw new HttpError(400, "Structura stării este invalidă.", validationErrors);
  }

  const savedState = await enqueueWrite(async () => {
    if (submittedState.revision !== currentState.revision) {
      throw new HttpError(
        409,
        "Starea a fost modificată în alt tab. Reîncarcă datele înainte de a salva din nou."
      );
    }
    const nextState = cloneJson({
      ...submittedState,
      revision: currentState.revision + 1,
      updatedAt: Date.now()
    });
    await atomicWriteState(nextState);
    currentState = nextState;
    return nextState;
  });
  sendJson(response, 200, savedState);
}

function isInsideRoot(candidatePath) {
  const relative = path.relative(rootRealPath, candidatePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function resolveStaticPath(pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname).replace(/\\/g, "/");
  } catch {
    throw new HttpError(400, "Calea URL nu este validă.");
  }
  if (decodedPath.includes("\0")) throw new HttpError(400, "Calea URL nu este validă.");

  const relativeRequestPath = decodedPath.replace(/^\/+/, "") || "index.html";
  let candidate = path.resolve(ROOT_DIR, relativeRequestPath);
  const lexicalRelative = path.relative(ROOT_DIR, candidate);
  if (lexicalRelative === ".." || lexicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(lexicalRelative)) {
    throw new HttpError(403, "Acces interzis.");
  }

  let stats;
  try {
    stats = await fsp.stat(candidate);
    if (stats.isDirectory()) {
      candidate = path.join(candidate, "index.html");
      stats = await fsp.stat(candidate);
    }
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") throw new HttpError(404, "Fișier inexistent.");
    throw error;
  }
  if (!stats.isFile()) throw new HttpError(404, "Fișier inexistent.");

  const realCandidate = await fsp.realpath(candidate);
  if (!isInsideRoot(realCandidate)) throw new HttpError(403, "Acces interzis.");
  return { filePath: realCandidate, stats };
}

async function handleStatic(request, response, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    sendText(response, 405, "Metodă nepermisă.", { Allow: "GET, HEAD" });
    return;
  }

  const { filePath, stats } = await resolveStaticPath(pathname);
  const contentType = MIME_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": stats.size,
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff"
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }

  const stream = fs.createReadStream(filePath);
  stream.on("error", error => {
    console.error("Eroare la citirea fișierului static:", error);
    if (!response.headersSent) sendText(response, 500, "Eroare internă.");
    else response.destroy(error);
  });
  stream.pipe(response);
}

async function handleRequest(request, response) {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (requestUrl.pathname === "/api/state") {
      await handleStateApi(request, response);
      return;
    }
    if (requestUrl.pathname.startsWith("/api/")) {
      sendJson(response, 404, { error: "Endpoint API inexistent." });
      return;
    }
    await handleStatic(request, response, requestUrl.pathname);
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    if (statusCode === 500) console.error(error);
    if (!response.headersSent) {
      sendJson(response, statusCode, {
        error: statusCode === 500 ? "Eroare internă a serverului." : error.message,
        ...(error.details ? { details: error.details } : {})
      });
    } else {
      response.destroy();
    }
  }
}

async function main() {
  const port = parsePort(process.env.PORT);
  await initializeState();

  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch(error => {
      console.error(error);
      if (!response.headersSent) sendJson(response, 500, { error: "Eroare internă a serverului." });
      else response.destroy();
    });
  });

  server.on("clientError", (error, socket) => {
    if (error.code !== "ECONNRESET" && socket.writable) {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    }
  });
  server.on("error", error => {
    console.error(`Serverul nu a putut porni pe portul ${port}:`, error.message);
    process.exitCode = 1;
  });
  server.listen(port, HOST, () => {
    console.log(`Grile Diana rulează la http://${HOST}:${port}`);
    console.log(`Starea este salvată în ${STATE_FILE}`);
    console.log("Oprește serverul cu Ctrl+C.");
  });
}

if (require.main === module) {
  main().catch(error => {
    console.error("Serverul nu a putut fi inițializat:", error.message);
    process.exitCode = 1;
  });
}
