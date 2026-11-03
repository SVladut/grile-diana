"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app-core.js"), "utf8");

function createApp(initialState = null, additionalBanks = {}) {
  let state = initialState || {
    version: 1,
    revision: 0,
    progress: { version: 1, updatedAt: null, questions: {} },
    mistakes: { version: 1, updatedAt: null, questions: {} },
    flashcards: { version: 1, updatedAt: null, ratings: {}, session: null },
    notes: { version: 1, updatedAt: null, testRuns: 0, sections: {}, subchapters: {} },
    history: [],
    session: null
  };
  const window = {
    GRILE_QUESTION_BANK: {
      chapters: [{
        id: "chapter-1",
        code: "1",
        title: "Test",
        subchapters: [{ id: "1.01", title: "Test", questionCount: 4 }]
      }],
      questions: [
        { id: "cs-1", fingerprint: "cs-1", chapterId: "chapter-1", subchapterId: "1.01", type: "CS", text: "Test CS", options: [{ id: "A", text: "Răspuns A" }], correct: ["A"] },
        { id: "cs-2", fingerprint: "cs-2", chapterId: "chapter-1", subchapterId: "1.01", type: "CS", text: "Test CS 2", options: [{ id: "A", text: "Răspuns A" }], correct: ["A"] },
        { id: "cm-1", fingerprint: "cm-1", chapterId: "chapter-1", subchapterId: "1.01", type: "CM", text: "Test CM", options: [{ id: "A", text: "Răspuns A" }], correct: ["A"] },
        { id: "cm-2", fingerprint: "cm-2", chapterId: "chapter-1", subchapterId: "1.01", type: "CM", text: "Test CM 2", options: [{ id: "A", text: "Răspuns A" }], correct: ["A"] }
      ]
    },
    NOTES_BANK: {
      version: 1,
      metadata: {},
      chapters: [],
      sections: [{ id: "section-1" }],
      subchapters: [{ id: "notes-subchapter-1" }]
    },
    ...additionalBanks,
    GrileFileStore: {
      ready: Promise.resolve(),
      getState: () => state,
      replace: async nextState => {
        state = JSON.parse(JSON.stringify(nextState));
        return state;
      }
    }
  };
  vm.runInNewContext(source, { window });
  return { app: window.GrileApp, getState: () => state };
}

test("custom test can select only simple questions", () => {
  const { app } = createApp();
  const session = app.createPracticeSession(["1.01"], 2, "CS");

  assert.equal(session.questionIds.length, 2);
  assert.ok(session.questionIds.every(id => app.questionById.get(id).type === "CS"));
  assert.equal(app.availableQuestionsForSubchapters(["1.01"], "CS").length, 2);
});

test("custom test can select only multiple-answer questions", () => {
  const { app } = createApp();
  const session = app.createPracticeSession(["1.01"], 2, "CM");

  assert.equal(session.questionIds.length, 2);
  assert.ok(session.questionIds.every(id => app.questionById.get(id).type === "CM"));
  assert.equal(app.availableQuestionsForSubchapters(["1.01"], "CM").length, 2);
});

test("custom test keeps the previous mixed-question behavior by default", () => {
  const { app } = createApp();
  const session = app.createPracticeSession(["1.01"], 4);

  assert.equal(session.questionIds.length, 4);
  assert.deepEqual(
    new Set(session.questionIds.map(id => app.questionById.get(id).type)),
    new Set(["CS", "CM"])
  );
});

test("custom test rejects an unsupported question type", () => {
  const { app } = createApp();

  assert.throws(() => app.createPracticeSession(["1.01"], 1, "invalid"), /Tipul întrebărilor/);
});

test("indexed question bank loads a shard only when session questions are requested", async () => {
  const questions = [
    { id: "cs-1", fingerprint: "cs-1", chapterId: "chapter-1", subchapterId: "1.01", type: "CS", text: "Test CS", options: [{ id: "A", text: "Răspuns A" }], correct: ["A"] },
    { id: "cm-1", fingerprint: "cm-1", chapterId: "chapter-1", subchapterId: "1.01", type: "CM", text: "Test CM", options: [{ id: "A", text: "Răspuns A" }], correct: ["A"] }
  ];
  let state = {
    version: 1,
    revision: 0,
    progress: { version: 1, updatedAt: null, questions: {} },
    mistakes: { version: 1, updatedAt: null, questions: {} },
    flashcards: { version: 1, updatedAt: null, ratings: {}, session: null },
    notes: { version: 1, updatedAt: null, testRuns: 0, sections: {}, subchapters: {} },
    history: [],
    session: null
  };
  const window = {
    GRILE_QUESTION_INDEX: {
      metadata: { questionCount: questions.length },
      chapters: [{ id: "chapter-1", code: "1", title: "Test", subchapters: [{ id: "1.01", title: "Test" }] }],
      questions: questions.map(question => [
        question.id,
        question.fingerprint,
        question.type,
        question.chapterId,
        question.subchapterId,
        "shard-0"
      ])
    },
    location: { href: "https://example.test/selectare.html" },
    document: {
      createElement: () => ({}),
      head: {
        append: script => {
          window.GRILE_QUESTION_SHARDS = { "shard-0": questions };
          script.onload();
        }
      }
    },
    NOTES_BANK: { version: 1, metadata: {}, chapters: [], sections: [], subchapters: [] },
    GrileFileStore: {
      ready: Promise.resolve(),
      getState: () => state,
      replace: async nextState => {
        state = JSON.parse(JSON.stringify(nextState));
        return state;
      }
    }
  };
  vm.runInNewContext(source, { window, URL, document: window.document, location: window.location });
  const app = window.GrileApp;

  assert.equal(app.bank.questions.length, 0);
  const session = app.createPracticeSession(["1.01"], 1, "CS");
  assert.equal(session.questionIds.length, 1);
  assert.equal(app.bank.questions.length, 0);
  await app.loadQuestionIds(session.questionIds);
  assert.equal(app.questionById.get(session.questionIds[0]).text, "Test CS");
  assert.equal(app.bank.questions.length, 2);
});

test("profile metrics work with lightweight flashcard and notes indexes", () => {
  const { app } = createApp(null, {
    FLASHCARD_INDEX: {
      metadata: { cardCount: 2 },
      chapters: [],
      decks: [{ id: "deck-1" }],
      cards: [{ id: "card-1", deckId: "deck-1" }, { id: "card-2", deckId: "deck-1" }]
    },
    NOTES_INDEX: {
      metadata: { sectionCount: 1, subchapterCount: 1 },
      chapters: [],
      subchapters: [{ id: "subchapter-1", sectionIds: ["section-1"] }],
      sections: [{ id: "section-1", subchapterId: "subchapter-1" }]
    }
  });

  assert.equal(app.flashcardMetrics().total, 2);
  assert.equal(app.notesMetrics().total, 1);
  assert.equal(app.notesMetrics().totalSubchapters, 1);
});

function createBackup({ progressQuestions = {}, history = [] } = {}) {
  return JSON.stringify({
    schema: "grile-diana-profile",
    version: 4,
    progress: { version: 1, updatedAt: 500, questions: progressQuestions },
    mistakes: { version: 1, updatedAt: null, questions: {} },
    flashcards: { version: 1, updatedAt: null, ratings: {}, session: null },
    notes: { version: 1, updatedAt: null, testRuns: 0, sections: {}, subchapters: {} },
    history,
    session: null
  });
}

function progressRecord(status, lastAnsweredAt, attempts = 1) {
  return {
    status,
    attempts,
    correctAttempts: status === "correct" ? attempts : 0,
    wrongAttempts: status === "wrong" ? attempts : 0,
    lastAnsweredAt
  };
}

test("backup merge preserves current progress and adds new questions and test history", async () => {
  const currentState = {
    version: 1,
    revision: 2,
    progress: {
      version: 1,
      updatedAt: 300,
      questions: {
        shared: progressRecord("correct", 300),
        currentOnly: progressRecord("wrong", 250)
      }
    },
    mistakes: { version: 1, updatedAt: null, questions: {} },
    flashcards: { version: 1, updatedAt: null, ratings: {}, session: null },
    notes: { version: 1, updatedAt: null, testRuns: 0, sections: {}, subchapters: {} },
    history: [{ id: "existing", mode: "practice", completedAt: 300, questions: [{ questionId: "cs-1" }] }],
    session: null
  };
  const { app, getState } = createApp(currentState);
  const backup = createBackup({
    progressQuestions: {
      shared: progressRecord("wrong", 100, 2),
      importedOnly: progressRecord("correct", 200)
    },
    history: [
      {
        id: "existing",
        mode: "practice",
        completedAt: 300,
        questions: [{
          questionId: "cs-1",
          text: "Text salvat",
          options: [{ id: "A", text: "Răspuns salvat" }]
        }]
      },
      { id: "imported", mode: "exam", completedAt: 150, questions: [{ questionId: "cm-1" }] }
    ]
  });

  await app.restoreProfileBackup(backup, "merge");

  const merged = getState();
  assert.equal(merged.progress.questions.shared.status, "correct");
  assert.ok(merged.progress.questions.currentOnly);
  assert.ok(merged.progress.questions.importedOnly);
  assert.deepEqual(merged.history.map(entry => entry.id).sort(), ["existing", "imported"]);
  assert.equal(merged.history.find(entry => entry.id === "existing").questions[0].text, "Text salvat");
});

test("completed test history snapshots the question and its answer options", async () => {
  const { app, getState } = createApp();
  const session = app.createPracticeSession(["1.01"], 1, "CS");
  const questionId = session.questionIds[0];
  await app.saveSession(session);
  await app.submitCurrentAnswer(session, ["A"]);

  const savedQuestion = getState().history[0].questions[0];
  assert.equal(savedQuestion.questionId, questionId);
  assert.equal(savedQuestion.text, app.questionById.get(questionId).text);
  assert.deepEqual(savedQuestion.options, app.questionById.get(questionId).options);
  assert.deepEqual(savedQuestion.selection, ["A"]);

  const exportedBackup = JSON.parse((await app.buildProfileBackup()).contents);
  assert.equal(exportedBackup.version, 5);
  assert.equal(exportedBackup.history[0].questions[0].text, savedQuestion.text);
});

test("backup merge retains flashcard and notes progress without adding overlapping counters", async () => {
  const currentState = {
    version: 1,
    revision: 0,
    progress: { version: 1, updatedAt: null, questions: {} },
    mistakes: {
      version: 1,
      updatedAt: 200,
      questions: {
        "mistake-current": { status: "active", wrongAttempts: 2, firstWrongAt: 100, lastWrongAt: 200, resolvedAt: null }
      }
    },
    flashcards: {
      version: 1,
      updatedAt: 200,
      ratings: {
        "card-current": { confidence: 3, reviews: 2, firstSeenAt: 100, lastReviewedAt: 200, nextDueAt: 300, intervalMinutes: 10 }
      },
      session: null
    },
    notes: {
      version: 1,
      updatedAt: 200,
      testRuns: 2,
      sections: {
        "section-1": {
          viewCount: 4, testAttempts: 2, correctAnswers: 1, totalAnswers: 2,
          firstViewedAt: 100, lastViewedAt: 200, completedAt: null,
          bestPercentage: 50, lastTestedAt: 200, lastPercentage: 50
        }
      },
      subchapters: {}
    },
    history: [],
    session: null
  };
  const { app, getState } = createApp(currentState);
  const backup = JSON.parse(createBackup());
  backup.mistakes.questions["mistake-current"] = {
    status: "mastered", wrongAttempts: 2, firstWrongAt: 100, lastWrongAt: 200, resolvedAt: 250
  };
  backup.mistakes.questions["mistake-imported"] = {
    status: "active", wrongAttempts: 1, firstWrongAt: 220, lastWrongAt: 220, resolvedAt: null
  };
  backup.flashcards.ratings["card-imported"] = {
    confidence: 4, reviews: 1, firstSeenAt: 150, lastReviewedAt: 250, nextDueAt: 350, intervalMinutes: 20
  };
  backup.notes.testRuns = 1;
  backup.notes.sections["section-1"] = {
    viewCount: 3, testAttempts: 4, correctAnswers: 3, totalAnswers: 4,
    firstViewedAt: 120, lastViewedAt: 250, completedAt: 220,
    bestPercentage: 75, lastTestedAt: 250, lastPercentage: 75
  };

  await app.restoreProfileBackup(JSON.stringify(backup), "merge");

  const merged = getState();
  assert.deepEqual(Object.keys(merged.flashcards.ratings).sort(), ["card-current", "card-imported"]);
  assert.equal(merged.mistakes.questions["mistake-current"].status, "mastered");
  assert.equal(merged.mistakes.questions["mistake-imported"].status, "active");
  assert.equal(merged.notes.testRuns, 2);
  assert.equal(merged.notes.sections["section-1"].viewCount, 4);
  assert.equal(merged.notes.sections["section-1"].testAttempts, 4);
  assert.equal(merged.notes.sections["section-1"].bestPercentage, 75);
  assert.equal(merged.notes.sections["section-1"].lastPercentage, 75);
  assert.equal(merged.notes.sections["section-1"].completedAt, 220);
});

test("backup replacement keeps the explicit legacy replace behavior", async () => {
  const { app, getState } = createApp({
    version: 1,
    revision: 0,
    progress: { version: 1, updatedAt: 100, questions: { currentOnly: progressRecord("wrong", 100) } },
    mistakes: { version: 1, updatedAt: null, questions: {} },
    flashcards: { version: 1, updatedAt: null, ratings: {}, session: null },
    notes: { version: 1, updatedAt: null, testRuns: 0, sections: {}, subchapters: {} },
    history: [{ id: "current", mode: "practice" }],
    session: null
  });

  await app.restoreProfileBackup(createBackup({
    progressQuestions: { importedOnly: progressRecord("correct", 200) }
  }), "replace");

  assert.deepEqual(Object.keys(getState().progress.questions), ["importedOnly"]);
  assert.deepEqual(getState().history, []);
});
