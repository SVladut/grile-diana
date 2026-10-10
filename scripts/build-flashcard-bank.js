"use strict";

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const sourcePath = path.resolve(process.argv[2] || path.join(projectRoot, "flashcard.json"));
const outputPath = path.resolve(process.argv[3] || path.join(projectRoot, "data", "flashcard-bank.js"));
const chapterTitles = new Map([
  ["1", "ODONTOTERAPIE"],
  ["2", "ENDODONȚIE"],
  ["3", "PROTETICĂ DENTARĂ"],
  ["4", "PARODONTOLOGIE"],
  ["5", "PEDODONȚIE"],
  ["6", "ORTODONȚIE"],
  ["7", "CHIRURGIE OMF"]
]);

function fail(message) {
  throw new Error(`Import flashcarduri: ${message}`);
}

// Exporturile complete pot conține mai multe obiecte JSON consecutive, câte
// unul pentru fiecare capitol. Le separăm fără să confundăm acoladele din text.
function parseJsonDocuments(raw) {
  const documents = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];

    if (start < 0) {
      if (/\s/.test(character)) continue;
      if (character !== "{" && character !== "[") {
        fail(`caracter neașteptat la poziția ${index + 1}.`);
      }
      start = index;
      depth = 1;
      continue;
    }

    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "{" || character === "[") {
      depth += 1;
    } else if (character === "}" || character === "]") {
      depth -= 1;
      if (depth < 0) fail(`închidere JSON neașteptată la poziția ${index + 1}.`);
      if (depth === 0) {
        const fragment = raw.slice(start, index + 1);
        try {
          const value = JSON.parse(fragment);
          if (Array.isArray(value)) documents.push(...value);
          else documents.push(value);
        } catch (error) {
          fail(`document JSON invalid început la poziția ${start + 1}: ${error.message}`);
        }
        start = -1;
      }
    }
  }

  if (start >= 0 || inString || depth !== 0) fail("ultimul document JSON este incomplet.");
  if (!documents.length) fail("fișierul nu conține niciun document JSON.");
  return documents;
}

function chapterIdFromDeck(deck) {
  const match = String(deck.name || "").trim().match(/^(\d+)/);
  return match ? match[1] : "alte";
}

const rawSource = fs.readFileSync(sourcePath, "utf8").replace(/^\uFEFF/, "");
const sources = parseJsonDocuments(rawSource);
const quizzes = sources.map((source, index) => {
  const quiz = source?.data?.quiz;
  if (!quiz || !Array.isArray(quiz.cards) || !Array.isArray(quiz.decks)) {
    fail(`documentul ${index + 1} nu conține structura data.quiz.cards/decks.`);
  }
  if (Number.isInteger(quiz.quantity) && quiz.quantity !== quiz.cards.length) {
    fail(`documentul ${index + 1} declară ${quiz.quantity} carduri, dar conține ${quiz.cards.length}.`);
  }
  return quiz;
});

const deckById = new Map();
for (const quiz of quizzes) {
  for (const rawDeck of quiz.decks) {
    const id = String(rawDeck?._id || "").trim();
    const name = String(rawDeck?.name || "").trim();
    if (!id || !name) fail("există un set fără ID sau nume.");

    const existing = deckById.get(id);
    if (existing) {
      if (existing.name !== name) fail(`setul ${id} apare cu două nume diferite.`);
      continue;
    }

    deckById.set(id, { id, name, chapterId: chapterIdFromDeck(rawDeck), cardIds: [] });
  }
}

const cardById = new Map();
for (const quiz of quizzes) {
  for (const [index, rawCard] of quiz.cards.entries()) {
    const id = String(rawCard?.cid || "").trim();
    const deckId = String(rawCard?.deckId || "").trim();
    const frontHtml = String(rawCard?.text || "").trim();
    const backHtml = String(rawCard?.answer || "").trim();
    const deck = deckById.get(deckId);
    if (!id) fail(`cardul ${index + 1} dintr-un document nu are ID.`);
    if (!deck) fail(`cardul ${id} indică un set inexistent.`);
    if (!frontHtml || !backHtml) fail(`cardul ${id} nu are față sau verso.`);

    const card = {
      id,
      deckId,
      chapterId: deck.chapterId,
      topicIndex: Number.isInteger(rawCard.topicIndex) ? rawCard.topicIndex : null,
      pages: Array.isArray(rawCard.pages)
        ? rawCard.pages.filter(page => Number.isInteger(page) && page > 0)
        : [],
      frontHtml,
      backHtml
    };
    const existing = cardById.get(id);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(card)) {
        fail(`cardul duplicat ${id} are conținut diferit.`);
      }
      continue;
    }
    cardById.set(id, card);
    deck.cardIds.push(id);
  }
}

const decks = [...deckById.values()].sort((left, right) =>
  left.name.localeCompare(right.name, "ro", { numeric: true })
);
const cards = [...cardById.values()];
const chapters = [...new Set(decks.map(deck => deck.chapterId))]
  .sort((left, right) => left.localeCompare(right, "ro", { numeric: true }))
  .map(chapterId => ({
    id: chapterId,
    code: chapterId === "alte" ? "—" : chapterId,
    title: chapterTitles.get(chapterId) || "ALTE MATERIALE",
    deckIds: decks.filter(deck => deck.chapterId === chapterId).map(deck => deck.id)
  }));

const sourceQuizIds = quizzes.map(quiz => String(quiz._id || "")).filter(Boolean);
const sourceUpdates = quizzes.map(quiz => quiz.updatedAt).filter(Boolean).sort();
const bank = {
  version: 1,
  sourceQuizIds,
  sourceUpdatedAt: sourceUpdates.at(-1) || null,
  metadata: {
    sourceCount: quizzes.length,
    cardCount: cards.length,
    deckCount: decks.length,
    chapterCount: chapters.length
  },
  chapters,
  decks,
  cards
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(
  outputPath,
  `(function (global) {\n  "use strict";\n  global.FLASHCARD_BANK = Object.freeze(${JSON.stringify(bank)});\n})(typeof window !== "undefined" ? window : globalThis);\n`,
  "utf8"
);

console.log(
  `Au fost importate ${cards.length} flashcarduri din ${quizzes.length} surse, în ${decks.length} seturi și ${chapters.length} capitole.`
);
console.log(outputPath);
