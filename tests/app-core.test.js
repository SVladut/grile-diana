"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app-core.js"), "utf8");

function createApp() {
  const window = {
    GRILE_QUESTION_BANK: {
      chapters: [{
        id: "chapter-1",
        subchapters: [{ id: "1.01", title: "Test", questionCount: 4 }]
      }],
      questions: [
        { id: "cs-1", fingerprint: "cs-1", subchapterId: "1.01", type: "CS" },
        { id: "cs-2", fingerprint: "cs-2", subchapterId: "1.01", type: "CS" },
        { id: "cm-1", fingerprint: "cm-1", subchapterId: "1.01", type: "CM" },
        { id: "cm-2", fingerprint: "cm-2", subchapterId: "1.01", type: "CM" }
      ]
    },
    GrileFileStore: {
      ready: Promise.resolve(),
      getState: () => ({}),
      replace: async state => state
    }
  };
  vm.runInNewContext(source, { window });
  return window.GrileApp;
}

test("custom test can select only simple questions", () => {
  const app = createApp();
  const session = app.createPracticeSession(["1.01"], 2, "CS");

  assert.equal(session.questionIds.length, 2);
  assert.ok(session.questionIds.every(id => app.questionById.get(id).type === "CS"));
  assert.equal(app.availableQuestionsForSubchapters(["1.01"], "CS").length, 2);
});

test("custom test can select only multiple-answer questions", () => {
  const app = createApp();
  const session = app.createPracticeSession(["1.01"], 2, "CM");

  assert.equal(session.questionIds.length, 2);
  assert.ok(session.questionIds.every(id => app.questionById.get(id).type === "CM"));
  assert.equal(app.availableQuestionsForSubchapters(["1.01"], "CM").length, 2);
});

test("custom test keeps the previous mixed-question behavior by default", () => {
  const app = createApp();
  const session = app.createPracticeSession(["1.01"], 4);

  assert.equal(session.questionIds.length, 4);
  assert.deepEqual(
    new Set(session.questionIds.map(id => app.questionById.get(id).type)),
    new Set(["CS", "CM"])
  );
});

test("custom test rejects an unsupported question type", () => {
  const app = createApp();

  assert.throws(() => app.createPracticeSession(["1.01"], 1, "invalid"), /Tipul întrebărilor/);
});
