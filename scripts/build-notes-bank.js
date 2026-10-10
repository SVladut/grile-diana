"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_PATH = path.join(ROOT, "data", "notite.json");
const QUESTION_BANK_PATH = path.join(ROOT, "data", "question-bank.js");
const OUTPUT_PATH = path.join(ROOT, "data", "notes-bank.js");
const MAX_ALTERNATIVES_PER_LINE = 3;
const ROMANIAN_STOP_WORDS = new Set([
  "aceasta", "aceste", "acestea", "acestui", "acestor", "acești", "acelea", "acela", "altor",
  "asupra", "atunci", "având", "care", "către", "când", "decât", "dintre", "după", "este",
  "fără", "fiind", "foarte", "într-o", "într-un", "pentru", "poate", "prin", "sau", "spre",
  "toate", "unor", "este", "sunt", "unei", "unui", "acest", "această", "cele", "celor", "între",
  "nivelul", "cazul", "cursul", "prezența", "apariția", "realizarea", "utilizarea", "determină",
  "determina", "reprezintă", "reprezinta", "constă", "consta", "privind", "aproximativ", "respectiv",
  "the", "and", "with", "from"
].map(answerKey));

function parseJsonDocuments(source) {
  const documents = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth < 0) throw new Error(`Unexpected closing brace at position ${index}.`);
      if (depth === 0 && start >= 0) {
        documents.push(JSON.parse(source.slice(start, index + 1)));
        start = -1;
      }
    }
  }
  if (inString || depth !== 0 || start !== -1) throw new Error("The notes source contains an incomplete JSON document.");
  return documents;
}

function decodeHtmlEntities(value) {
  const named = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"', ndash: "–", mdash: "—"
  };
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match);
}

function plainText(markup) {
  return decodeHtmlEntities(String(markup || "")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]*>/g, " "))
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

function answerKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("ro-RO")
    .replace(/[–—−]/g, "-")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/×/g, "x")
    .replace(/(\d),(?=\d)/g, "$1.")
    .replace(/[^\p{L}\p{N}%+./<>=°µμ-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function colorFromAttributes(attributes) {
  const match = String(attributes || "").match(/(?:^|[;"'\s])color\s*:\s*([^;"']+)/i);
  return match ? match[1].trim().toLowerCase().replace(/\s+/g, "") : "";
}

function isOrange(color) {
  return color === "orange" || color === "#ffa500" || color === "rgb(255,165,0)";
}

function replaceFirst(text, answer) {
  const index = text.indexOf(answer);
  if (index < 0) return null;
  return `${text.slice(0, index)}_____ ${text.slice(index + answer.length)}`.replace(/_____\s+([,.;:!?])/g, "_____$1");
}

function usableAnswer(rawAnswer) {
  const answer = plainText(rawAnswer).replace(/^[:;,\s]+|[:;,\s]+$/g, "").trim();
  const key = answerKey(answer);
  if (!key || answer.length > 140 || key.split(" ").length > 18) return null;
  return { answer, key };
}

function highlightedCandidates(fragment, includeOrange) {
  const candidates = [];
  for (const match of String(fragment).matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi)) {
    const color = colorFromAttributes(match[1]);
    if (!color || isOrange(color) !== includeOrange) continue;
    const usable = usableAnswer(match[2]);
    if (usable) candidates.push({ ...usable, color });
  }
  return candidates;
}

function strongCandidates(fragment) {
  const candidates = [];
  for (const match of String(fragment).matchAll(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi)) {
    const usable = usableAnswer(match[1]);
    if (usable) candidates.push({ ...usable, color: "strong" });
  }
  return candidates;
}

function extractListFragments(markup) {
  const source = String(markup || "");
  const stack = [];
  const fragments = [];
  const tagPattern = /<\/?li\b[^>]*>/gi;
  let lastIndex = 0;
  let match;

  while ((match = tagPattern.exec(source))) {
    if (stack.length) stack[stack.length - 1].parts.push(source.slice(lastIndex, match.index));
    const closing = /^<\//.test(match[0]);
    if (closing) {
      const item = stack.pop();
      if (item) {
        const fragment = item.parts.join("");
        if (plainText(fragment)) fragments.push({ fragment, sourceOrder: item.sourceOrder });
      }
    } else {
      stack.push({ parts: [], sourceOrder: match.index });
    }
    lastIndex = tagPattern.lastIndex;
  }
  if (stack.length) stack[stack.length - 1].parts.push(source.slice(lastIndex));
  while (stack.length) {
    const item = stack.pop();
    const fragment = item.parts.join("");
    if (plainText(fragment)) fragments.push({ fragment, sourceOrder: item.sourceOrder });
  }

  if (!fragments.length && plainText(source)) return [source];
  return fragments
    .sort((left, right) => left.sourceOrder - right.sourceOrder)
    .map(item => item.fragment);
}

function emphasizedCandidates(fragment) {
  const candidates = [];
  for (const tagName of ["em", "i", "strong"]) {
    const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi");
    for (const match of String(fragment).matchAll(pattern)) {
      const usable = usableAnswer(match[1]);
      if (usable) candidates.push({ ...usable, color: "emphasis" });
    }
  }
  return candidates;
}

function lexicalCandidates(sentence) {
  const separatorIndex = sentence.indexOf(":");
  const content = (separatorIndex >= 0 ? sentence.slice(separatorIndex + 1) : sentence)
    .replace(/^\s*[-–—•\d.)]+\s*/, "")
    .trim();
  if (!content) return [];

  const tokens = [...content.matchAll(/[\p{L}\p{N}][\p{L}\p{N}%+./<>=≤≥°µμ–—-]*/gu)]
    .map(match => match[0].replace(/^[.,;:!?]+|[.,;:!?]+$/g, ""))
    .filter(Boolean)
    .filter(token => {
      const key = answerKey(token);
      if (!key || ROMANIAN_STOP_WORDS.has(key)) return false;
      return /\d/u.test(token) || token.length >= 4;
    });

  return [...new Set(tokens)]
    .sort((left, right) => {
      const leftScore = (/\d/u.test(left) ? 20 : 0) + Math.min(left.length, 18);
      const rightScore = (/\d/u.test(right) ? 20 : 0) + Math.min(right.length, 18);
      return rightScore - leftScore;
    })
    .map(token => ({ answer: token, key: answerKey(token), color: "generated" }));
}

function createClozes(topic) {
  const markup = String(topic.text || "");
  const fragments = extractListFragments(markup);
  const candidates = [];

  fragments.forEach((fragment, sourceLineIndex) => {
    const sentence = plainText(fragment);
    const separatorIndex = sentence.indexOf(":");
    const afterLabel = separatorIndex >= 0 ? sentence.slice(separatorIndex + 1).trim() : sentence;
    if (!afterLabel) return;

    const lineCandidates = [
      ...highlightedCandidates(fragment, false),
      ...emphasizedCandidates(fragment),
      ...lexicalCandidates(sentence)
    ];
    const seenLineAnswers = new Set();
    lineCandidates.forEach(candidate => {
      if (candidates.filter(item => item.sourceLineIndex === sourceLineIndex).length >= MAX_ALTERNATIVES_PER_LINE) return;
      if (seenLineAnswers.has(candidate.key)) return;
      const answerPosition = sentence.indexOf(candidate.answer);
      if (answerPosition < 0 || (separatorIndex >= 0 && answerPosition <= separatorIndex)) return;
      const prompt = replaceFirst(sentence, candidate.answer);
      if (!prompt) return;
      seenLineAnswers.add(candidate.key);
      candidates.push({
        prompt,
        answer: candidate.answer,
        answerKey: candidate.key,
        source: candidate.color,
        sourceLineIndex
      });
    });
  });

  if (!candidates.length) {
    const titleAnswer = usableAnswer(topic.title);
    if (!titleAnswer) throw new Error(`Section ${topic.tid} cannot produce a cloze exercise.`);
    candidates.push({
      prompt: "Completează denumirea ideii-cheie: _____",
      answer: titleAnswer.answer,
      answerKey: titleAnswer.key,
      source: "title-fallback",
      sourceLineIndex: 0
    });
  }

  const seen = new Set();
  return candidates
    .filter(candidate => {
      const signature = `${candidate.prompt}\u0000${candidate.answerKey}`;
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    })
    .map((candidate, index) => ({
      id: `cloze-${topic.tid}-${index + 1}`,
      answer: candidate.answer,
      answerKey: candidate.answerKey,
      source: candidate.source,
      lineIndex: candidate.sourceLineIndex,
      ...(candidate.source === "title-fallback" ? { prompt: candidate.prompt } : {})
    }));
}

function sourceCode(name) {
  const match = String(name || "").normalize("NFC").match(/^(\d+(?:\.\d+){1,2})\./);
  return match?.[1] || null;
}

function validPages(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(Number)
    .filter(page => Number.isInteger(page) && page > 0))]
    .sort((left, right) => left - right);
}

function build() {
  global.window = global;
  require(QUESTION_BANK_PATH);
  const sourceChapters = global.GRILE_QUESTION_BANK.chapters
    .filter(chapter => Number(chapter.code) >= 1 && Number(chapter.code) <= 7);
  delete global.window;

  const documents = parseJsonDocuments(fs.readFileSync(SOURCE_PATH, "utf8"));
  if (documents.length !== 73) throw new Error(`Expected 73 JSON documents, received ${documents.length}.`);

  const sourceByCode = new Map();
  documents.forEach((document, index) => {
    const summary = document?.data?.atlas?.summary;
    if (!summary || !Array.isArray(summary.topics)) throw new Error(`Document ${index + 1} has an invalid summary.`);
    const code = sourceCode(summary.name);
    if (!code || sourceByCode.has(code)) throw new Error(`Document ${index + 1} has a missing or duplicate code (${code}).`);
    sourceByCode.set(code, summary);
  });

  const canonicalSubchapters = sourceChapters.flatMap(chapter => chapter.subchapters.map(subchapter => ({
    ...subchapter,
    chapterId: chapter.id,
    chapterCode: chapter.code
  })));
  if (canonicalSubchapters.length !== 72) throw new Error(`Expected 72 canonical subchapters, received ${canonicalSubchapters.length}.`);

  const sectionIds = new Set();
  const clozeIds = new Set();
  const sections = [];
  const subchapters = canonicalSubchapters.map(subchapter => {
    const summary = sourceByCode.get(subchapter.id);
    if (!summary) throw new Error(`Notes are missing for subchapter ${subchapter.id}.`);
    const ids = summary.topics.map((topic, index) => {
      if (!topic?.tid || typeof topic.title !== "string" || typeof topic.text !== "string") {
        throw new Error(`Invalid topic ${index + 1} in ${subchapter.id}.`);
      }
      const id = `note-${topic.tid}`;
      if (sectionIds.has(id)) throw new Error(`Duplicate section id ${id}.`);
      sectionIds.add(id);
      const clozes = createClozes(topic);
      clozes.forEach(cloze => {
        if (clozeIds.has(cloze.id)) throw new Error(`Duplicate cloze id ${cloze.id}.`);
        clozeIds.add(cloze.id);
      });
      sections.push({
        id,
        subchapterId: subchapter.id,
        chapterId: subchapter.chapterId,
        order: index + 1,
        title: topic.title.normalize("NFC").trim(),
        html: topic.text.normalize("NFC").trim(),
        pages: validPages(topic.pages),
        clozes,
        recallLineCount: new Set(clozes.map(cloze => cloze.lineIndex)).size
      });
      return id;
    });
    return {
      id: subchapter.id,
      code: subchapter.id,
      chapterId: subchapter.chapterId,
      title: subchapter.title.normalize("NFC"),
      sectionIds: ids,
      sectionCount: ids.length,
      clozeCount: ids.reduce((sum, sectionId) => {
        const section = sections.find(item => item.id === sectionId);
        return sum + section.clozes.length;
      }, 0),
      recallLineCount: ids.reduce((sum, sectionId) => {
        const section = sections.find(item => item.id === sectionId);
        return sum + section.recallLineCount;
      }, 0)
    };
  });

  const unusedCodes = [...sourceByCode.keys()].filter(code => !canonicalSubchapters.some(item => item.id === code));
  if (unusedCodes.length !== 1 || unusedCodes[0] !== "3.03") {
    throw new Error(`Unexpected non-canonical note documents: ${unusedCodes.join(", ")}.`);
  }
  if (sections.length !== 1951) throw new Error(`Expected 1951 sections after excluding 3.03, received ${sections.length}.`);
  if (sections.some(section => !section.clozes.length)) throw new Error("Every section must contain at least one cloze.");

  const subchapterById = new Map(subchapters.map(subchapter => [subchapter.id, subchapter]));
  const chapters = sourceChapters.map(chapter => {
    const subchapterIds = chapter.subchapters.map(subchapter => subchapter.id);
    return {
      id: chapter.id,
      code: chapter.code,
      title: chapter.title,
      subchapterIds,
      subchapterCount: subchapterIds.length,
      sectionCount: subchapterIds.reduce((sum, id) => sum + subchapterById.get(id).sectionCount, 0),
      clozeCount: subchapterIds.reduce((sum, id) => sum + subchapterById.get(id).clozeCount, 0),
      recallLineCount: subchapterIds.reduce((sum, id) => sum + subchapterById.get(id).recallLineCount, 0)
    };
  });

  const bank = {
    version: 1,
    metadata: {
      title: "Materiale de studiu — Grile Diana",
      sourceDocumentCount: documents.length,
      excludedSourceCode: "3.03",
      chapterCount: chapters.length,
      subchapterCount: subchapters.length,
      sectionCount: sections.length,
      clozeCount: sections.reduce((sum, section) => sum + section.clozes.length, 0),
      recallLineCount: sections.reduce((sum, section) => sum + section.recallLineCount, 0)
    },
    chapters,
    subchapters,
    sections
  };

  fs.writeFileSync(OUTPUT_PATH, `window.NOTES_BANK=${JSON.stringify(bank)};\n`, "utf8");
  console.log(JSON.stringify({
    output: path.relative(ROOT, OUTPUT_PATH),
    bytes: fs.statSync(OUTPUT_PATH).size,
    ...bank.metadata,
    chapterSections: chapters.map(chapter => ({ code: chapter.code, subchapters: chapter.subchapterCount, sections: chapter.sectionCount })),
    fallbackSections: sections.filter(section => section.clozes.some(cloze => cloze.source.includes("fallback"))).length
  }, null, 2));
}

build();
