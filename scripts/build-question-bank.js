"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SQL_PATH = path.join(ROOT, "grile_db.sql");
const SUBJECTS_JSON_PATH = path.join(ROOT, "data", "subiecte-2021-2025.json");
const HISTORICAL_JSON_PATH = path.join(ROOT, "data", "grile-anterioare.json");
const SET2_JSON_PATH = path.join(ROOT, "data", "set-2-grile.json");
const OUTPUT_PATH = path.join(ROOT, "data", "question-bank.js");
const SUBJECTS_CHAPTER_ID = "subiecte-2021-2025";
const SUBJECTS_CHAPTER_TITLE = "Subiecte 2021-2025 pe capitole";
const HISTORICAL_CHAPTER_ID = "grile-anterioare";
const HISTORICAL_CHAPTER_TITLE = "SUBIECTE ANTERIOARE";
const SET2_CHAPTER_ID = "set-2";
const SET2_CHAPTER_TITLE = "SET 2";
const OPTION_IDS = ["A", "B", "C", "D", "E"];

const catalog = [
  {
    id: "capitol-1",
    code: "1",
    title: "ODONTOTERAPIE",
    subchapters: [
      ["1.01", "Țesuturile dure dentare – structură, implicații clinice", "624713bb327119885ebed0a6"],
      ["1.02", "Etiologia cariei simple", "624713bb327119885ebed0b3"],
      ["1.03", "Aspecte histopatologice ale cariei simple", "624713bb327119885ebed0a9"],
      ["1.04", "Diagnosticul leziunilor carioase", "624713bb327119885ebed0a4"],
      ["1.05", "Diagnosticul leziunilor necarioase", "624713bb327119885ebed0b8"],
      ["1.06", "Principii generale de tratament al cariei simple", "624713bb327119885ebed0a7"],
      ["1.07", "Tratamentul cariei simple cavitare", "624713bb327119885ebed0b4"],
      ["1.08", "Materiale dentare utilizate modern în tratamentele odontorestauratoare", "624713bb327119885ebed0a1"]
    ]
  },
  {
    id: "capitol-2",
    code: "2",
    title: "ENDODONȚIE",
    subchapters: [
      ["2.01", "Examinare și diagnostic în endodonție", "624713bb327119885ebed0a3"],
      ["2.02", "Patologia pulpară și periapicală", "624713bb327119885ebed0ab"],
      ["2.03", "Tratamentul chemo-mecanic al canalelor radiculare", "624713bb327119885ebed0b5"],
      ["2.04", "Dezinfecția canalelor radiculare", "624713bb327119885ebed0af"],
      ["2.05", "Obturația de canal", "624713bb327119885ebed0b6"],
      ["2.06", "Incidente și accidente în cursul tratamentului endodontic", "624713bb327119885ebed0ac"]
    ]
  },
  {
    id: "capitol-3",
    code: "3",
    title: "PROTETICĂ DENTARĂ",
    subchapters: [
      ["3.01", "Ocluzologie", "624713bb327119885ebed0a8"],
      ["3.02", "Edentație parțială redusă", "624713bb327119885ebed0aa"],
      ["3.03.1", "Etiologia și tabloul clinic al edentației parțial întinse", "678233de6d2e3f0017f91610"],
      ["3.03.2", "Examene clinice și paraclinice în edentația parțială și totală", "678234566d2e3f0017f9170c"],
      ["3.03.3", "Mijloace protetice utilizate în edentația parțială întinsă (EPÎ)", "678234916d2e3f0017f91765"],
      ["3.03.4", "Algoritm de tratament în EPÎ și soluții terapeutice", "678234ff6d2e3f0017f917fd"],
      ["3.03.5", "Abordări terapeutice moderne în edentația totală", "678235386d2e3f0017f9189d"]
    ]
  },
  {
    id: "capitol-4",
    code: "4",
    title: "PARODONTOLOGIE",
    subchapters: [
      ["4.01", "Anatomia, structura și funcțiile parodonțiului", "624713bb327119885ebed0b0"],
      ["4.02", "Etiopatogenia bolii parodontale", "624713bb327119885ebed0b1"],
      ["4.03", "Influența infecției parodontale asupra bolilor sistemice", "624713bb327119885ebed0ae"],
      ["4.04", "Diagnosticul parodontal", "624713bb327119885ebed0ad"],
      ["4.05", "Gingivite", "624713bb327119885ebed0a2"],
      ["4.06", "Parodontite", "624713bb327119885ebed0a5"],
      ["4.07", "Tratamentul parodontal", "624713bb327119885ebed0b2"]
    ]
  },
  {
    id: "capitol-5",
    code: "5",
    title: "PEDODONȚIE",
    subchapters: [
      ["5.01", "Erupția dentară", "624713bb327119885ebed0d6"],
      ["5.02", "Profilaxia cariei dentare în perioada de creștere", "624713bb327119885ebed0c7"],
      ["5.03", "Caria dinților temporari", "624713bb327119885ebed0d9"],
      ["5.04", "Caria dinților permanenți imaturi", "624713bb327119885ebed0db"],
      ["5.05", "Urgențele în practica pedodontică", "624713bb327119885ebed0d2"],
      ["5.06", "Relația medic-pacient în pedodonție", "624713bb327119885ebed0d1"]
    ]
  },
  {
    id: "capitol-6",
    code: "6",
    title: "ORTODONȚIE ȘI ORTOPEDIE DENTO-FACIALĂ",
    subchapters: [
      ["6.1.1", "Dinții supranumerari", "624713bb327119885ebed0df"],
      ["6.1.2", "Anodonția", "624713bb327119885ebed0cb"],
      ["6.1.3", "Incluzia dentară", "624713bb327119885ebed0d3"],
      ["6.1.4", "Reincluzia dentară", "624713bb327119885ebed0c6"],
      ["6.1.5", "Ectopia dentară", "624713bb327119885ebed0de"],
      ["6.1.6", "Transpoziția dentară", "624713bb327119885ebed0c8"],
      ["6.1.7", "Diastema", "624713bb327119885ebed0e0"],
      ["6.2.1", "Compresiunea de maxilar", "624713bb327119885ebed0c9"],
      ["6.2.2", "Ocluzia adâncă acoperită", "624713bb327119885ebed0c2"],
      ["6.2.3", "Ocluzia deschisă", "624713bb327119885ebed0c0"],
      ["6.2.4", "Sindromul Progenic (prognatismul mandibular)", "624713bb327119885ebed0bb"]
    ]
  },
  {
    id: "capitol-7",
    code: "7",
    title: "CHIRURGIE ORO-MAXILO-FACIALĂ",
    subchapters: [
      ["7.01", "Substanțe anestezice utilizate în stomatologie", "624713bb327119885ebed0d7"],
      ["7.02", "Tehnici folosite în anestezia loco-regională", "624713bb327119885ebed0e2"],
      ["7.03", "Accidente și complicații ale anesteziei loco-regionale în stomatologie", "624713bb327119885ebed0ca"],
      ["7.04", "Indicațiile extracției dentare", "624713bb327119885ebed0c5"],
      ["7.05", "Contraindicații în extracția dentară", "624713bb327119885ebed0dd"],
      ["7.06", "Extracția dentară cu separație interradiculară", "624713bb327119885ebed0c1"],
      ["7.07", "Extracția prin alveolotomie", "624713bb327119885ebed0b9"],
      ["7.08", "Accidente și complicații ale extracției dentare", "624713bb327119885ebed0d4"],
      ["7.09", "Tulburări", "624713bb327119885ebed0cc"],
      ["7.10", "Odontectomia molarului de minte inferior", "624713bb327119885ebed0d0"],
      ["7.11", "Odontectomia caninului superior", "624713bb327119885ebed0c4"],
      ["7.12", "Tipuri de lambouri pentru rezecția apicală", "624713bb327119885ebed0cf"],
      ["7.13", "Tratamentul chirurgical preprotetic al părților moi", "624713bb327119885ebed0ce"],
      ["7.14", "Infecțiile periosoase", "624713bb327119885ebed0bf"],
      ["7.15", "Infecții difuze oro-maxilo-faciale", "624713bb327119885ebed0d5"],
      ["7.16", "Fasciita necrozantă cervicală", "624713bb327119885ebed0bd"],
      ["7.17", "Infecțiile nespecifice ale oaselor maxilare", "624713bb327119885ebed0be"],
      ["7.18", "Osteonecroza maxilarelor", "624713bb327119885ebed0ba"],
      ["7.19", "Comunicarea oro-sinuzală", "624713bb327119885ebed0e3"],
      ["7.20", "Traumatologie oro-maxilo-facială", "624713bb327119885ebed0c3"],
      ["7.21", "Chisturi și tumori benigne ale părților moi orale și cervico-faciale", "624713bb327119885ebed0cd"],
      ["7.22", "Chisturi, tumori benigne și osteopatii ale oaselor maxilare", "624713bb327119885ebed0d8"],
      ["7.23", "Tumori maligne oro-maxilo-faciale", "624713bb327119885ebed0e4"],
      ["7.24", "Luxația temporo-mandibulară", "624713bb327119885ebed0e1"],
      ["7.25", "Anchiloza temporo-mandibulară", "624713bb327119885ebed0bc"],
      ["7.26", "Patologia glandelor salivare", "624713bb327119885ebed0dc"],
      ["7.27", "Despicăturile labio-maxilo-palatine", "624713bb327119885ebed0da"]
    ]
  }
];

function decodeMysqlString(value) {
  return value.replace(/\\([0btnrZ'"\\])/g, (_, escaped) => ({
    "0": "\0",
    b: "\b",
    t: "\t",
    n: "\n",
    r: "\r",
    Z: "\x1a",
    "'": "'",
    '"': '"',
    "\\": "\\"
  })[escaped]);
}

function parseTuple(line) {
  const values = [];
  let index = 1;

  while (index < line.length) {
    while (/\s/.test(line[index])) index += 1;

    if (line[index] === "'") {
      index += 1;
      let value = "";
      while (index < line.length) {
        if (line[index] === "\\" && index + 1 < line.length) {
          value += line[index] + line[index + 1];
          index += 2;
        } else if (line[index] === "'" && line[index + 1] === "'") {
          value += "'";
          index += 2;
        } else if (line[index] === "'") {
          index += 1;
          break;
        } else {
          value += line[index];
          index += 1;
        }
      }
      values.push(decodeMysqlString(value));
    } else {
      const start = index;
      while (index < line.length && line[index] !== "," && line[index] !== ")") index += 1;
      const raw = line.slice(start, index).trim();
      values.push(raw === "NULL" ? null : Number(raw));
    }

    while (/\s/.test(line[index])) index += 1;
    if (line[index] === ",") index += 1;
    else if (line[index] === ")") break;
  }

  return values;
}

function stripQuestionNumber(text) {
  return String(text || "").replace(/^\s*\d+\s*[.)]\s*/, "").trim();
}

function normalizeText(text) {
  return stripQuestionNumber(text)
    .normalize("NFKC")
    .toLocaleLowerCase("ro")
    .replace(/[„”“]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\s*\{202[1-5]\}\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fingerprint(text, options) {
  const normalized = [normalizeText(text), ...options.map(normalizeText)].join("\u241f");
  return crypto.createHash("sha1").update(normalized).digest("hex").slice(0, 16);
}

function bitCount(value) {
  let count = 0;
  let remaining = value;
  while (remaining) {
    count += remaining & 1;
    remaining >>>= 1;
  }
  return count;
}

function decodeAnswerMask(mask) {
  // Toate sursele Grile Rezi folosesc aceeași convenție: A=16, B=8, C=4, D=2, E=1.
  return OPTION_IDS.filter((_, optionIndex) => mask & (1 << (4 - optionIndex)));
}

function parseSql() {
  const rowsByTable = new Map();
  const lines = fs.readFileSync(SQL_PATH, "utf8").split(/\r?\n/);
  let activeTable = null;

  for (const line of lines) {
    const insertMatch = line.match(/^INSERT INTO `([^`]+)`/);
    if (insertMatch) {
      activeTable = insertMatch[1];
      if (!rowsByTable.has(activeTable)) rowsByTable.set(activeTable, []);
      continue;
    }

    if (activeTable && line.startsWith("(")) {
      const tuple = parseTuple(line);
      if (tuple.length !== 10) {
        throw new Error(`Invalid tuple in ${activeTable}: expected 10 fields, received ${tuple.length}.`);
      }
      rowsByTable.get(activeTable).push(tuple);
    }
  }

  return rowsByTable;
}

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
        throw new Error(`Unexpected character in concatenated JSON at position ${index + 1}.`);
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
    if (character === '"') inString = true;
    else if (character === "{" || character === "[") depth += 1;
    else if (character === "}" || character === "]") {
      depth -= 1;
      if (depth < 0) throw new Error(`Unexpected JSON closing token at position ${index + 1}.`);
      if (depth === 0) {
        const value = JSON.parse(raw.slice(start, index + 1));
        documents.push(...(Array.isArray(value) ? value : [value]));
        start = -1;
      }
    }
  }
  if (start >= 0 || depth !== 0 || inString) throw new Error("The last concatenated JSON document is incomplete.");
  if (!documents.length) throw new Error("The concatenated JSON file is empty.");
  return documents;
}

function parseSubjectsJson() {
  const payload = JSON.parse(fs.readFileSync(SUBJECTS_JSON_PATH, "utf8"));
  const exam = payload?.data?.exam;
  if (!exam || !Array.isArray(exam.questions) || !Array.isArray(exam.chapters)) {
    throw new Error("Invalid subjects JSON: data.exam.questions and data.exam.chapters are required.");
  }
  if (exam.quantity !== exam.questions.length) {
    throw new Error(`Subjects quantity mismatch: declared=${exam.quantity}, received=${exam.questions.length}.`);
  }

  const apiChapterById = new Map(exam.chapters.map(chapter => [chapter._id, chapter]));
  if (apiChapterById.size !== exam.chapters.length) {
    throw new Error("The subjects JSON contains duplicate chapter identifiers.");
  }

  if (exam.chapters.length !== 7) {
    throw new Error(`Expected 7 subjects disciplines, received ${exam.chapters.length}.`);
  }
  const subchapterByApiId = new Map(exam.chapters.map((chapter, index) => [chapter._id, {
    id: `subiecte-${String(index + 1).padStart(2, "0")}`,
    title: String(chapter.name || "").trim(),
    chapterId: SUBJECTS_CHAPTER_ID,
    questionCount: 0
  }]));
  const seenQuestionIds = new Set();
  const optionIds = ["A", "B", "C", "D", "E"];

  const questions = exam.questions.map(rawQuestion => {
    if (!rawQuestion?.qid || seenQuestionIds.has(rawQuestion.qid)) {
      throw new Error(`Invalid or duplicate subject question id: ${rawQuestion?.qid}.`);
    }
    seenQuestionIds.add(rawQuestion.qid);

    const subchapter = subchapterByApiId.get(rawQuestion.chapterId);
    if (!subchapter || !apiChapterById.has(rawQuestion.chapterId)) {
      throw new Error(`Unknown chapter for subject question ${rawQuestion.qid}: ${rawQuestion.chapterId}.`);
    }
    if (rawQuestion.answersCount !== 5 || !Array.isArray(rawQuestion.answers) || rawQuestion.answers.length !== 5) {
      throw new Error(`Subject question ${rawQuestion.qid} must contain exactly five answers.`);
    }

    const correctCode = String(rawQuestion.correct || "").trim().toLowerCase();
    const mask = Number.parseInt(correctCode, 36);
    if (!/^[0-9a-z]+$/.test(correctCode) || !Number.isInteger(mask) || mask < 1 || mask > 31) {
      throw new Error(`Invalid subject answer mask "${correctCode}" for ${rawQuestion.qid}.`);
    }
    if (bitCount(mask) !== rawQuestion.correctAnswersCount) {
      throw new Error(`Subject answer count mismatch for ${rawQuestion.qid}: mask=${correctCode}.`);
    }

    const optionTexts = rawQuestion.answers.map(answer => String(answer || "").trim());
    if (optionTexts.some(answer => !answer)) {
      throw new Error(`Subject question ${rawQuestion.qid} contains an empty answer.`);
    }

    const text = stripQuestionNumber(rawQuestion.text);
    const yearMatch = text.match(/\{(202[1-5])\}\s*$/);
    if (!yearMatch) {
      throw new Error(`Subject question ${rawQuestion.qid} does not end with a 2021-2025 year marker.`);
    }
    const pages = Array.isArray(rawQuestion.pages) ? rawQuestion.pages.map(Number) : [];
    if (!pages.length || pages.some(page => !Number.isInteger(page) || page < 1)) {
      throw new Error(`Subject question ${rawQuestion.qid} must contain at least one valid page number.`);
    }

    // The API stores A as bit 16 and E as bit 1, encoded as a base-36 string.
    const correct = decodeAnswerMask(mask);
    subchapter.questionCount += 1;

    return {
      id: `subiect-${rawQuestion.qid}`,
      fingerprint: fingerprint(text, optionTexts),
      chapterId: subchapter.chapterId,
      subchapterId: subchapter.id,
      type: correct.length === 1 ? "CS" : "CM",
      text,
      options: optionTexts.map((optionText, optionIndex) => ({ id: optionIds[optionIndex], text: optionText })),
      correct,
      year: Number(yearMatch[1]),
      pages,
      source: "subiecte-2021-2025"
    };
  });

  const subchapters = exam.chapters.map(chapter => subchapterByApiId.get(chapter._id));
  if (subchapters.some(subchapter => !subchapter.title || subchapter.questionCount < 1)) {
    throw new Error("Every imported subjects subchapter must have a title and at least one question.");
  }

  return {
    chapter: {
      id: SUBJECTS_CHAPTER_ID,
      code: "8",
      title: SUBJECTS_CHAPTER_TITLE,
      questionCount: questions.length,
      subchapters
    },
    questions
  };
}

function parseHistoricalJson() {
  const documents = parseJsonDocuments(fs.readFileSync(HISTORICAL_JSON_PATH, "utf8").replace(/^\uFEFF/, ""));
  if (documents.length !== 2) {
    throw new Error(`Expected 2 historical JSON documents, received ${documents.length}.`);
  }

  const optionIds = ["A", "B", "C", "D", "E"];
  const chapterDefinitions = new Map();
  const rawQuestions = [];
  const seenQids = new Set();
  let declaredTotal = 0;

  documents.forEach((document, documentIndex) => {
    const exam = document?.data?.exam;
    if (!exam || !Array.isArray(exam.questions) || !Array.isArray(exam.chapters)) {
      throw new Error(`Historical document ${documentIndex + 1} must contain data.exam.questions/chapters.`);
    }
    if (exam.quantity !== exam.questions.length) {
      throw new Error(`Historical quantity mismatch in document ${documentIndex + 1}: declared=${exam.quantity}, received=${exam.questions.length}.`);
    }
    declaredTotal += exam.quantity;

    exam.chapters.forEach(apiChapter => {
      const name = String(apiChapter?.name || "").trim();
      const yearMatch = name.match(/(202[1-5])/);
      const kind = /^Rezidențiat/i.test(name) ? "rezidentiat" : /^Simulare/i.test(name) ? "simulare" : null;
      if (!apiChapter?._id || !name || !yearMatch || !kind || chapterDefinitions.has(apiChapter._id)) {
        throw new Error(`Invalid or duplicate historical chapter: ${apiChapter?._id || "missing id"}.`);
      }
      const year = Number(yearMatch[1]);
      chapterDefinitions.set(apiChapter._id, {
        id: `anterioare-${kind}-${year}`,
        title: name,
        year,
        kind,
        questionCount: 0
      });
    });

    exam.questions.forEach(rawQuestion => {
      if (!rawQuestion?.qid || seenQids.has(rawQuestion.qid)) {
        throw new Error(`Invalid or duplicate historical question id: ${rawQuestion?.qid}.`);
      }
      seenQids.add(rawQuestion.qid);
      const subchapter = chapterDefinitions.get(rawQuestion.chapterId);
      if (!subchapter) throw new Error(`Unknown historical chapter for ${rawQuestion.qid}.`);
      if (rawQuestion.answersCount !== 5 || !Array.isArray(rawQuestion.answers) || rawQuestion.answers.length !== 5) {
        throw new Error(`Historical question ${rawQuestion.qid} must contain exactly five answers.`);
      }
      const correctCode = String(rawQuestion.correct || "").trim().toLowerCase();
      const mask = Number.parseInt(correctCode, 36);
      if (!/^[0-9a-z]+$/.test(correctCode) || !Number.isInteger(mask) || mask < 1 || mask > 31) {
        throw new Error(`Invalid historical answer mask "${correctCode}" for ${rawQuestion.qid}.`);
      }
      if (bitCount(mask) !== rawQuestion.correctAnswersCount) {
        throw new Error(`Historical answer count mismatch for ${rawQuestion.qid}: mask=${correctCode}.`);
      }
      const optionTexts = rawQuestion.answers.map(answer => String(answer || "").trim());
      if (optionTexts.some(answer => !answer)) throw new Error(`Historical question ${rawQuestion.qid} contains an empty answer.`);
      const pages = Array.isArray(rawQuestion.pages) ? rawQuestion.pages.map(Number) : [];
      if (pages.some(page => !Number.isInteger(page) || page < 1)) {
        throw new Error(`Historical question ${rawQuestion.qid} contains an invalid page.`);
      }
      const correct = decodeAnswerMask(mask);
      const text = stripQuestionNumber(rawQuestion.text);
      subchapter.questionCount += 1;
      rawQuestions.push({
        id: `anterioare-${rawQuestion.qid}`,
        fingerprint: fingerprint(text, optionTexts),
        chapterId: HISTORICAL_CHAPTER_ID,
        subchapterId: subchapter.id,
        type: correct.length === 1 ? "CS" : "CM",
        text,
        options: optionTexts.map((optionText, optionIndex) => ({ id: optionIds[optionIndex], text: optionText })),
        correct,
        year: subchapter.year,
        pages,
        source: "grile-anterioare",
        historicalKind: subchapter.kind
      });
    });
  });

  if (declaredTotal !== 1800 || rawQuestions.length !== 1800 || seenQids.size !== 1800) {
    throw new Error(`Expected exactly 1800 historical questions, received ${rawQuestions.length}.`);
  }
  const subchapters = [...chapterDefinitions.values()]
    .map(({ id, title, questionCount }) => ({ id, title, questionCount }));
  if (subchapters.length !== 9 || subchapters.some(subchapter => subchapter.questionCount !== 200)) {
    throw new Error("Expected 9 historical sets with exactly 200 questions each.");
  }

  return {
    chapter: {
      id: HISTORICAL_CHAPTER_ID,
      code: "9",
      title: HISTORICAL_CHAPTER_TITLE,
      questionCount: rawQuestions.length,
      subchapters
    },
    questions: rawQuestions
  };
}

function parseSet2Json() {
  const documents = parseJsonDocuments(fs.readFileSync(SET2_JSON_PATH, "utf8").replace(/^\uFEFF/, ""));
  if (documents.length !== 8) {
    throw new Error(`Expected 8 Set 2 JSON documents, received ${documents.length}.`);
  }

  const optionIds = ["A", "B", "C", "D", "E"];
  const subchapterByApiId = new Map();
  const subchapterByCode = new Map();
  const questions = [];
  const seenQids = new Set();
  let declaredTotal = 0;

  documents.forEach((document, documentIndex) => {
    const exam = document?.data?.exam;
    if (!exam || !Array.isArray(exam.questions) || !Array.isArray(exam.chapters)) {
      throw new Error(`Set 2 document ${documentIndex + 1} must contain data.exam.questions/chapters.`);
    }
    if (exam.quantity !== exam.questions.length) {
      throw new Error(`Set 2 quantity mismatch in document ${documentIndex + 1}: declared=${exam.quantity}, received=${exam.questions.length}.`);
    }
    declaredTotal += exam.quantity;

    exam.chapters.forEach(apiChapter => {
      const apiId = String(apiChapter?._id || "").trim();
      const title = String(apiChapter?.name || "").trim().normalize("NFC");
      const codeMatch = title.match(/^(\d+(?:\.\d+)+)\./);
      if (!apiId || !title || !codeMatch) throw new Error(`Invalid Set 2 chapter: ${apiId || "missing id"}.`);
      const code = codeMatch[1];
      const existingApiChapter = subchapterByApiId.get(apiId);
      if (existingApiChapter) {
        if (existingApiChapter.title !== title || existingApiChapter.code !== code) {
          throw new Error(`Set 2 chapter ${apiId} appears with conflicting metadata.`);
        }
        return;
      }
      if (subchapterByCode.has(code)) {
        throw new Error(`Set 2 chapter code ${code} appears with multiple identifiers.`);
      }
      const subchapter = {
        id: `set2-${code}`,
        code,
        title,
        questionCount: 0
      };
      subchapterByApiId.set(apiId, subchapter);
      subchapterByCode.set(code, subchapter);
    });

    exam.questions.forEach(rawQuestion => {
      const qid = String(rawQuestion?.qid || "").trim();
      if (!qid || seenQids.has(qid)) throw new Error(`Invalid or duplicate Set 2 question id: ${qid || "missing id"}.`);
      seenQids.add(qid);
      const subchapter = subchapterByApiId.get(String(rawQuestion.chapterId || ""));
      if (!subchapter) throw new Error(`Unknown Set 2 chapter for ${qid}.`);
      if (rawQuestion.answersCount !== 5 || !Array.isArray(rawQuestion.answers) || rawQuestion.answers.length !== 5) {
        throw new Error(`Set 2 question ${qid} must contain exactly five answers.`);
      }
      const correctCode = String(rawQuestion.correct || "").trim().toLowerCase();
      const mask = Number.parseInt(correctCode, 36);
      if (!/^[0-9a-z]+$/.test(correctCode) || !Number.isInteger(mask) || mask < 1 || mask > 31) {
        throw new Error(`Invalid Set 2 answer mask "${correctCode}" for ${qid}.`);
      }
      if (bitCount(mask) !== rawQuestion.correctAnswersCount) {
        throw new Error(`Set 2 answer count mismatch for ${qid}: mask=${correctCode}.`);
      }
      const optionTexts = rawQuestion.answers.map(answer => String(answer || "").trim().normalize("NFC"));
      if (optionTexts.some(answer => !answer)) throw new Error(`Set 2 question ${qid} contains an empty answer.`);
      const pages = Array.isArray(rawQuestion.pages) ? rawQuestion.pages.map(Number) : [];
      if (pages.some(page => !Number.isInteger(page) || page < 1)) {
        throw new Error(`Set 2 question ${qid} contains an invalid page.`);
      }
      const correct = decodeAnswerMask(mask);
      const text = stripQuestionNumber(rawQuestion.text).normalize("NFC");
      subchapter.questionCount += 1;
      questions.push({
        id: `set2-${qid}`,
        fingerprint: fingerprint(text, optionTexts),
        chapterId: SET2_CHAPTER_ID,
        subchapterId: subchapter.id,
        type: correct.length === 1 ? "CS" : "CM",
        text,
        options: optionTexts.map((optionText, optionIndex) => ({ id: optionIds[optionIndex], text: optionText })),
        correct,
        pages,
        source: "set-2"
      });
    });
  });

  if (declaredTotal !== 6503 || questions.length !== 6503 || seenQids.size !== 6503) {
    throw new Error(`Expected exactly 6503 Set 2 questions, received ${questions.length}.`);
  }
  const subchapters = [...subchapterByCode.values()]
    .sort((left, right) => left.code.localeCompare(right.code, "ro", { numeric: true }))
    .map(({ id, title, questionCount }) => ({ id, title, questionCount }));
  if (subchapters.length !== 72 || subchapters.some(subchapter => subchapter.questionCount < 1)) {
    throw new Error(`Expected 72 non-empty Set 2 subchapters, received ${subchapters.length}.`);
  }

  return {
    chapter: {
      id: SET2_CHAPTER_ID,
      code: "10",
      title: SET2_CHAPTER_TITLE,
      questionCount: questions.length,
      subchapters
    },
    questions
  };
}

function buildBank() {
  const rowsByTable = parseSql();
  const mappedTables = new Set();
  const questions = [];
  const promptIndex = new Map();

  const chapters = catalog.map(chapter => {
    const subchapters = chapter.subchapters.map(([id, title, sourceTable]) => {
      if (mappedTables.has(sourceTable)) throw new Error(`Table mapped twice: ${sourceTable}.`);
      mappedTables.add(sourceTable);

      const rows = rowsByTable.get(sourceTable);
      if (!rows?.length) throw new Error(`Mapped table has no questions: ${sourceTable}.`);

      rows.forEach(tuple => {
        const [sourceId, rawText, ...rest] = tuple;
        const optionTexts = rest.slice(0, 5).map(value => String(value ?? "").trim());
        const correctCode = String(rest[5] ?? "").trim().toLowerCase();
        const expectedCorrectCount = Number(rest[7]);
        const mask = Number.parseInt(correctCode, 32);

        if (!Number.isInteger(mask) || mask < 1 || mask > 31) {
          throw new Error(`Invalid answer mask "${correctCode}" in ${sourceTable}/${sourceId}.`);
        }
        if (bitCount(mask) !== expectedCorrectCount) {
          throw new Error(`Answer count mismatch in ${sourceTable}/${sourceId}: mask=${correctCode}, expected=${expectedCorrectCount}.`);
        }
        if (optionTexts.some(option => !option)) {
          throw new Error(`Empty option in ${sourceTable}/${sourceId}.`);
        }

        const optionIds = ["A", "B", "C", "D", "E"];
        const correct = decodeAnswerMask(mask);
        const text = stripQuestionNumber(rawText);
        const questionFingerprint = fingerprint(text, optionTexts);
        const question = {
          id: `${id}-${sourceId}`,
          fingerprint: questionFingerprint,
          chapterId: chapter.id,
          subchapterId: id,
          type: correct.length === 1 ? "CS" : "CM",
          text,
          options: optionTexts.map((optionText, optionIndex) => ({ id: optionIds[optionIndex], text: optionText })),
          correct
        };

        questions.push(question);
        const normalizedPrompt = normalizeText(text);
        const promptMatches = promptIndex.get(normalizedPrompt) || [];
        promptMatches.push(question);
        promptIndex.set(normalizedPrompt, promptMatches);
      });

      return { id, title, questionCount: rows.length };
    });

    return {
      id: chapter.id,
      code: chapter.code,
      title: chapter.title,
      questionCount: subchapters.reduce((sum, subchapter) => sum + subchapter.questionCount, 0),
      subchapters
    };
  });

  if (mappedTables.size !== 72) throw new Error(`Expected 72 mapped tables, received ${mappedTables.size}.`);

  const fingerprintGroups = Map.groupBy(questions, question => question.fingerprint);
  const duplicateGroups = [...fingerprintGroups.values()].filter(group => group.length > 1);

  const examTables = [...rowsByTable.entries()].filter(([table]) => !mappedTables.has(table));
  const examRows = examTables.flatMap(([table, rows]) => rows.map(tuple => ({ table, tuple })));
  let matchedExamRows = 0;
  let ambiguousExamRows = 0;
  const unmatchedExamRows = [];

  for (const { table, tuple } of examRows) {
    const prompt = normalizeText(tuple[1]);
    const matches = promptIndex.get(prompt) || [];
    if (matches.length === 1) matchedExamRows += 1;
    else if (matches.length > 1) ambiguousExamRows += 1;
    else unmatchedExamRows.push({ table, sourceId: tuple[0], text: stripQuestionNumber(tuple[1]) });
  }

  const importedSubjects = parseSubjectsJson();
  const historical = parseHistoricalJson();
  const set2 = parseSet2Json();
  const baseChapters = [...chapters, importedSubjects.chapter];
  const baseQuestions = [...questions, ...importedSubjects.questions];
  const seenFingerprints = new Set();
  const deduplicatedBaseQuestions = baseQuestions.filter(question => {
    if (seenFingerprints.has(question.fingerprint)) return false;
    seenFingerprints.add(question.fingerprint);
    return true;
  });
  const bankQuestions = [...deduplicatedBaseQuestions, ...historical.questions, ...set2.questions];
  const fingerprintsBeforeSet2 = new Set([...deduplicatedBaseQuestions, ...historical.questions].map(question => question.fingerprint));
  const bankChapters = [...baseChapters, historical.chapter, set2.chapter].map(chapter => {
    const subchapters = chapter.subchapters.map(subchapter => ({
      ...subchapter,
      questionCount: bankQuestions.filter(question => question.subchapterId === subchapter.id).length
    }));
    return {
      ...chapter,
      questionCount: subchapters.reduce((sum, subchapter) => sum + subchapter.questionCount, 0),
      subchapters
    };
  });

  const bank = {
    version: 2,
    metadata: {
      title: "Grile Diana — Rezidențiat Stomatologie",
      questionCount: bankQuestions.length,
      simpleCount: bankQuestions.filter(question => question.type === "CS").length,
      multipleCount: bankQuestions.filter(question => question.type === "CM").length,
      chapterCount: bankChapters.length,
      subchapterCount: bankChapters.reduce((sum, chapter) => sum + chapter.subchapters.length, 0)
    },
    chapters: bankChapters,
    questions: bankQuestions
  };

  fs.writeFileSync(OUTPUT_PATH, `window.GRILE_QUESTION_BANK=${JSON.stringify(bank)};\n`, "utf8");

  console.log(JSON.stringify({
    output: path.relative(ROOT, OUTPUT_PATH),
    bytes: fs.statSync(OUTPUT_PATH).size,
    ...bank.metadata,
    duplicateCanonicalGroups: duplicateGroups.length,
    removedDuplicateQuestions: baseQuestions.length - deduplicatedBaseQuestions.length,
    importedSubjects: importedSubjects.questions.length,
    importedHistorical: historical.questions.length,
    historicalUniqueFingerprints: new Set(historical.questions.map(question => question.fingerprint)).size,
    historicalRepeatedOccurrences: historical.questions.length - new Set(historical.questions.map(question => question.fingerprint)).size,
    historicalOccurrencesAlreadyInBank: historical.questions.filter(question => seenFingerprints.has(question.fingerprint)).length,
    importedSet2: set2.questions.length,
    set2UniqueFingerprints: new Set(set2.questions.map(question => question.fingerprint)).size,
    set2RepeatedOccurrences: set2.questions.length - new Set(set2.questions.map(question => question.fingerprint)).size,
    set2OccurrencesAlreadyInPreviousChapters: set2.questions.filter(question => fingerprintsBeforeSet2.has(question.fingerprint)).length,
    uniqueQuestionsAvailable: new Set(bankQuestions.map(question => question.fingerprint)).size,
    excludedExamTables: examTables.map(([table, rows]) => ({ table, rows: rows.length })),
    examRows: examRows.length,
    matchedExamRows,
    ambiguousExamRows,
    unmatchedExamRows: unmatchedExamRows.length,
    unmatchedExamples: unmatchedExamRows.slice(0, 10)
  }, null, 2));
}

buildBank();
