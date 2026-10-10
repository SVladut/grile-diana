(function initGrileApp(global) {
  "use strict";

  const bank = global.GRILE_QUESTION_BANK;
  if (!bank?.questions?.length) {
    throw new Error("Banca de întrebări nu a fost încărcată.");
  }

  const fileStore = global.GrileFileStore;
  if (!fileStore?.ready || typeof fileStore.getState !== "function" || typeof fileStore.replace !== "function") {
    throw new Error("Magazia de date pe fișier nu a fost încărcată.");
  }

  const ready = Promise.resolve(fileStore.ready);
  const OPTION_IDS = ["A", "B", "C", "D", "E"];
  const flashcardBank = global.FLASHCARD_BANK || {
    version: 1,
    metadata: { cardCount: 0, deckCount: 0, chapterCount: 0 },
    chapters: [],
    decks: [],
    cards: []
  };
  const notesBank = global.NOTES_BANK || {
    version: 1,
    metadata: { chapterCount: 0, subchapterCount: 0, sectionCount: 0, clozeCount: 0 },
    chapters: [],
    subchapters: [],
    sections: []
  };
  const questionById = new Map(bank.questions.map(question => [question.id, question]));
  const flashcardById = new Map(flashcardBank.cards.map(card => [card.id, card]));
  const flashcardDeckById = new Map(flashcardBank.decks.map(deck => [deck.id, deck]));
  const noteSectionById = new Map(notesBank.sections.map(section => [section.id, section]));
  const noteSubchapterById = new Map(notesBank.subchapters.map(subchapter => [subchapter.id, subchapter]));
  const subchapterById = new Map();
  const chapterById = new Map();

  bank.chapters.forEach(chapter => {
    chapterById.set(chapter.id, chapter);
    chapter.subchapters.forEach(subchapter => {
      subchapterById.set(subchapter.id, { ...subchapter, chapterId: chapter.id });
    });
  });

  function emptyProgress(updatedAt = null) {
    return { version: 1, updatedAt, questions: {} };
  }

  function emptyMistakes(updatedAt = null) {
    return { version: 1, updatedAt, questions: {} };
  }

  function emptyFlashcards(updatedAt = null) {
    return {
      version: 1,
      updatedAt,
      ratings: {},
      session: null
    };
  }

  function emptyNotes(updatedAt = null) {
    return {
      version: 1,
      updatedAt,
      testRuns: 0,
      sections: {},
      subchapters: {}
    };
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function mistakesFromProgress(progress) {
    const questions = {};
    Object.entries(progress?.questions || {}).forEach(([questionId, record]) => {
      if (record?.status !== "wrong") return;
      const wrongAt = Number.isFinite(record.lastAnsweredAt) ? record.lastAnsweredAt : null;
      questions[questionId] = {
        status: "active",
        firstWrongAt: wrongAt,
        lastWrongAt: wrongAt,
        wrongAttempts: Math.max(1, Number.isInteger(record.wrongAttempts) ? record.wrongAttempts : 1),
        resolvedAt: null
      };
    });
    return {
      version: 1,
      updatedAt: progress?.updatedAt || null,
      questions
    };
  }

  function normalizeMistakes(rawMistakes, progress) {
    return rawMistakes?.version === 1 && isPlainObject(rawMistakes.questions)
      ? rawMistakes
      : mistakesFromProgress(progress);
  }

  function normalizeFlashcards(rawFlashcards) {
    return rawFlashcards?.version === 1 && isPlainObject(rawFlashcards.ratings)
      ? {
          ...rawFlashcards,
          session: isPlainObject(rawFlashcards.session) ? rawFlashcards.session : null
        }
      : emptyFlashcards();
  }

  function normalizeNotes(rawNotes) {
    return rawNotes?.version === 1 && isPlainObject(rawNotes.sections) && isPlainObject(rawNotes.subchapters)
      ? {
          ...rawNotes,
          testRuns: Number.isInteger(rawNotes.testRuns) && rawNotes.testRuns >= 0 ? rawNotes.testRuns : 0
        }
      : emptyNotes();
  }

  function normalizeState(rawState) {
    const state = rawState && typeof rawState === "object" ? rawState : {};
    const progress = state.progress;
    return {
      ...state,
      version: 1,
      progress: progress?.version === 1 && progress.questions && typeof progress.questions === "object"
        ? progress
        : emptyProgress(),
      mistakes: normalizeMistakes(state.mistakes, progress),
      flashcards: normalizeFlashcards(state.flashcards),
      notes: normalizeNotes(state.notes),
      history: Array.isArray(state.history) ? state.history : [],
      session: state.session && typeof state.session === "object" ? state.session : null
    };
  }

  function readState() {
    return normalizeState(fileStore.getState());
  }

  async function persistState(nextState) {
    await ready;
    const state = normalizeState(nextState);
    state.updatedAt = Date.now();
    await fileStore.replace(state);
    return state;
  }

  function normalizeSelection(selection) {
    const values = Array.isArray(selection) ? selection : [];
    return [...new Set(values.map(value => String(value).toUpperCase()))]
      .filter(value => OPTION_IDS.includes(value))
      .sort((left, right) => OPTION_IDS.indexOf(left) - OPTION_IDS.indexOf(right));
  }

  function selectionsEqual(first, second) {
    const left = normalizeSelection(first);
    const right = normalizeSelection(second);
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }

  function scoreQuestion(question, rawSelection) {
    if (!question) throw new Error("Întrebarea nu există în bancă.");

    const selection = normalizeSelection(rawSelection);
    const fullyCorrect = selectionsEqual(selection, question.correct);

    if (question.type === "CS") {
      return {
        score: fullyCorrect ? 4 : 0,
        maxScore: 4,
        fullyCorrect,
        selection
      };
    }

    if (selection.length === 0 || selection.length === OPTION_IDS.length) {
      return { score: 0, maxScore: 5, fullyCorrect: false, selection };
    }

    const selected = new Set(selection);
    const correct = new Set(question.correct);
    const score = OPTION_IDS.reduce((sum, optionId) => {
      return sum + (selected.has(optionId) === correct.has(optionId) ? 1 : 0);
    }, 0);

    return { score, maxScore: 5, fullyCorrect, selection };
  }

  function randomIndex(maxExclusive) {
    if (maxExclusive <= 1) return 0;
    const cryptoApi = global.crypto;
    if (!cryptoApi?.getRandomValues) return Math.floor(Math.random() * maxExclusive);

    const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
    const value = new Uint32Array(1);
    do cryptoApi.getRandomValues(value);
    while (value[0] >= limit);
    return value[0] % maxExclusive;
  }

  function shuffle(items) {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swapIndex = randomIndex(index + 1);
      [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
    }
    return copy;
  }

  function uniqueQuestions(questions) {
    const seenFingerprints = new Set();
    return shuffle(questions).filter(question => {
      if (seenFingerprints.has(question.fingerprint)) return false;
      seenFingerprints.add(question.fingerprint);
      return true;
    });
  }

  function availableQuestionsForSubchapters(subchapterIds) {
    const requested = new Set(subchapterIds);
    return uniqueQuestions(bank.questions.filter(question => requested.has(question.subchapterId)));
  }

  function createId() {
    return global.crypto?.randomUUID?.() || `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function createSession(mode, questions, config = {}) {
    if (!questions.length) throw new Error("Nu există întrebări disponibile pentru această selecție.");

    const questionIds = questions.map(question => question.id);
    const createdAt = Date.now();
    const durationSeconds = mode === "exam" ? 240 * 60 : 0;
    const firstQuestionId = questionIds[0];

    return {
      version: 1,
      id: createId(),
      mode,
      status: "active",
      createdAt,
      updatedAt: createdAt,
      completedAt: null,
      durationSeconds,
      endsAt: durationSeconds ? createdAt + durationSeconds * 1000 : null,
      questionIds,
      selectedSubchapterIds: config.selectedSubchapterIds || [],
      requestedCount: questionIds.length,
      currentQuestionId: firstQuestionId,
      pendingQuestionIds: questionIds.slice(1),
      answers: {},
      presented: { [firstQuestionId]: 1 },
      deferred: {},
      result: null
    };
  }

  function createPracticeSession(subchapterIds, requestedCount) {
    const selected = [...new Set(subchapterIds)].filter(id => subchapterById.has(id));
    if (!selected.length) throw new Error("Selectează cel puțin un subcapitol.");

    const available = availableQuestionsForSubchapters(selected);
    const count = Number(requestedCount);
    if (!Number.isInteger(count) || count < 1) {
      throw new Error("Numărul de întrebări trebuie să fie un număr întreg pozitiv.");
    }

    if (count > available.length) {
      throw new Error(`Selecția conține doar ${available.length} întrebări unice. Alege cel mult ${available.length}.`);
    }

    return createSession("practice", available.slice(0, count), { selectedSubchapterIds: selected });
  }

  function getMistakes() {
    return readState().mistakes;
  }

  function mistakeQuestions() {
    const mistakes = getMistakes();
    const questions = Object.entries(mistakes.questions)
      .filter(([, record]) => record?.status === "active")
      .map(([questionId]) => questionById.get(questionId))
      .filter(Boolean);
    return uniqueQuestions(questions);
  }

  function createMistakeSession(requestedCount) {
    const available = mistakeQuestions();
    if (!available.length) {
      throw new Error("Nu ai întrebări greșite de recapitulat. Continuă să exersezi și vor apărea automat aici.");
    }

    const count = Number(requestedCount);
    if (!Number.isInteger(count) || count < 1) {
      throw new Error("Numărul de întrebări trebuie să fie un număr întreg pozitiv.");
    }
    if (count > available.length) {
      throw new Error(`Lista conține doar ${available.length} întrebări greșite. Alege cel mult ${available.length}.`);
    }

    return createSession("mistakes", available.slice(0, count), {
      selectedSubchapterIds: [...new Set(available.slice(0, count).map(question => question.subchapterId))]
    });
  }

  function createExamSession() {
    const simple = uniqueQuestions(bank.questions.filter(question => question.type === "CS"));
    const multiple = uniqueQuestions(bank.questions.filter(question => question.type === "CM"));

    if (simple.length < 50 || multiple.length < 150) {
      throw new Error("Banca nu conține suficiente întrebări CS și CM pentru simularea completă.");
    }

    const questions = [...simple.slice(0, 50), ...multiple.slice(0, 150)];
    return createSession("exam", questions);
  }

  function getFlashcardState() {
    return readState().flashcards;
  }

  function flashcardsForDecks(deckIds) {
    if (!Array.isArray(deckIds)) return [...flashcardBank.cards];
    const selected = new Set(deckIds.filter(deckId => flashcardDeckById.has(deckId)));
    return flashcardBank.cards.filter(card => selected.has(card.deckId));
  }

  function flashcardMetrics(deckIds) {
    const cards = flashcardsForDecks(deckIds);
    const ratings = getFlashcardState().ratings;
    const now = Date.now();
    let studied = 0;
    let mastered = 0;
    let due = 0;
    let reviews = 0;
    let confidenceTotal = 0;

    cards.forEach(card => {
      const record = ratings[card.id];
      if (!record) return;
      studied += 1;
      reviews += Number.isInteger(record.reviews) ? record.reviews : 0;
      confidenceTotal += Number(record.confidence) || 0;
      if (record.confidence === 5) mastered += 1;
      if (!Number.isFinite(record.nextDueAt) || record.nextDueAt <= now) due += 1;
    });

    return {
      total: cards.length,
      studied,
      unstudied: cards.length - studied,
      mastered,
      due,
      reviews,
      averageConfidence: studied ? Math.round((confidenceTotal / studied) * 10) / 10 : 0
    };
  }

  function prioritizedFlashcards(cards, ratings) {
    const now = Date.now();
    const shuffled = shuffle(cards);
    return shuffled.sort((left, right) => {
      const leftRecord = ratings[left.id];
      const rightRecord = ratings[right.id];
      const group = record => {
        if (record && (!Number.isFinite(record.nextDueAt) || record.nextDueAt <= now)) return 0;
        if (!record) return 1;
        return 2;
      };
      const groupDifference = group(leftRecord) - group(rightRecord);
      if (groupDifference) return groupDifference;
      const confidenceDifference = (leftRecord?.confidence || 0) - (rightRecord?.confidence || 0);
      if (confidenceDifference) return confidenceDifference;
      return (leftRecord?.lastReviewedAt || 0) - (rightRecord?.lastReviewedAt || 0);
    });
  }

  function createFlashcardSession(deckIds, requestedCount) {
    if (!flashcardBank.cards.length) {
      throw new Error("Banca de flashcarduri nu este încărcată.");
    }
    const selectedDeckIds = [...new Set(Array.isArray(deckIds) ? deckIds : [])]
      .filter(deckId => flashcardDeckById.has(deckId));
    if (!selectedDeckIds.length) throw new Error("Selectează cel puțin un set de flashcarduri.");

    const available = flashcardsForDecks(selectedDeckIds);
    const count = Number(requestedCount);
    if (!Number.isInteger(count) || count < 1) {
      throw new Error("Numărul de carduri trebuie să fie un număr întreg pozitiv.");
    }
    if (count > available.length) {
      throw new Error(`Selecția conține doar ${available.length} flashcarduri. Alege cel mult ${available.length}.`);
    }

    const scheduled = prioritizedFlashcards(available, getFlashcardState().ratings).slice(0, count);
    const createdAt = Date.now();
    return {
      version: 1,
      id: createId(),
      status: "active",
      createdAt,
      updatedAt: createdAt,
      completedAt: null,
      deckIds: selectedDeckIds,
      targetReviews: count,
      reviewedCount: 0,
      currentCardId: scheduled[0].id,
      queue: scheduled.slice(1).map(card => card.id),
      uniqueSeen: {},
      ratingCounts: { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 },
      confidenceGain: 0,
      result: null
    };
  }

  function getFlashcardSession() {
    const session = getFlashcardState().session;
    if (!session || session.version !== 1) return null;
    const ids = [session.currentCardId, ...(session.queue || [])].filter(Boolean);
    return ids.every(cardId => flashcardById.has(cardId)) ? session : null;
  }

  async function saveFlashcardSession(session) {
    await ready;
    if (!isPlainObject(session) || session.version !== 1 || !["active", "completed"].includes(session.status)) {
      throw new Error("Sesiunea de flashcarduri este invalidă.");
    }
    const previousUpdatedAt = session.updatedAt;
    session.updatedAt = Date.now();
    const state = readState();
    state.flashcards.session = cloneSerializable(session);
    state.flashcards.updatedAt = session.updatedAt;
    try {
      await persistState(state);
    } catch (error) {
      session.updatedAt = previousUpdatedAt;
      throw error;
    }
    return session;
  }

  function nextFlashcardInterval(previous, confidence) {
    const baseMinutes = { 1: 5, 2: 30, 3: 12 * 60, 4: 3 * 24 * 60, 5: 21 * 24 * 60 };
    const multipliers = { 3: 1.5, 4: 2.5, 5: 4 };
    const base = baseMinutes[confidence];
    if (confidence <= 2 || !Number.isFinite(previous?.intervalMinutes)) return base;
    return Math.round(Math.max(base, previous.intervalMinutes * multipliers[confidence]));
  }

  async function rateFlashcard(session, confidence) {
    await ready;
    const rating = Number(confidence);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new Error("Încrederea trebuie evaluată cu o notă de la 1 la 5.");
    }
    if (!session || session.status !== "active" || !session.currentCardId) {
      throw new Error("Nu există un flashcard activ de evaluat.");
    }
    const card = flashcardById.get(session.currentCardId);
    if (!card) throw new Error("Flashcardul activ nu există în bancă.");

    const sessionSnapshot = cloneSerializable(session);
    const state = readState();
    const previous = state.flashcards.ratings[card.id];
    const reviewedAt = Date.now();
    const intervalMinutes = nextFlashcardInterval(previous, rating);
    const record = {
      confidence: rating,
      reviews: (Number.isInteger(previous?.reviews) ? previous.reviews : 0) + 1,
      firstSeenAt: previous?.firstSeenAt || reviewedAt,
      lastReviewedAt: reviewedAt,
      nextDueAt: reviewedAt + intervalMinutes * 60 * 1000,
      intervalMinutes
    };

    try {
      state.flashcards.ratings[card.id] = record;
      state.flashcards.updatedAt = reviewedAt;
      session.reviewedCount += 1;
      session.ratingCounts[String(rating)] = (session.ratingCounts[String(rating)] || 0) + 1;
      session.uniqueSeen[card.id] = true;
      session.confidenceGain += Math.max(0, rating - (previous?.confidence || 0));
      session.updatedAt = reviewedAt;

      const reviewsRemaining = Math.max(0, session.targetReviews - session.reviewedCount);
      if (reviewsRemaining === 0) {
        session.status = "completed";
        session.completedAt = reviewedAt;
        session.currentCardId = null;
        session.queue = [];
        session.result = {
          reviewedCount: session.reviewedCount,
          uniqueCount: Object.keys(session.uniqueSeen).length,
          ratingCounts: { ...session.ratingCounts },
          averageConfidence: session.reviewedCount
            ? Math.round((Object.entries(session.ratingCounts).reduce((sum, [value, count]) => sum + Number(value) * count, 0) / session.reviewedCount) * 10) / 10
            : 0,
          confidenceGain: session.confidenceGain
        };
      } else {
        if (rating <= 2 && reviewsRemaining > 0) {
          const repeatAfter = rating === 1 ? 2 : 6;
          const repeatIndex = Math.min(repeatAfter, session.queue.length, reviewsRemaining - 1);
          session.queue.splice(repeatIndex, 0, card.id);
        }
        while (session.queue.length > reviewsRemaining) session.queue.pop();
        session.currentCardId = session.queue.shift() || card.id;
      }

      state.flashcards.session = cloneSerializable(session);
      await persistState(state);
    } catch (error) {
      restoreSerializable(session, sessionSnapshot);
      throw error;
    }

    return {
      cardId: card.id,
      confidence: rating,
      record,
      completed: session.status === "completed",
      nextCardId: session.currentCardId
    };
  }

  async function clearFlashcardSession() {
    await ready;
    const state = readState();
    state.flashcards.session = null;
    state.flashcards.updatedAt = Date.now();
    await persistState(state);
  }

  async function resetFlashcardProgress() {
    await ready;
    const state = readState();
    state.flashcards = emptyFlashcards(Date.now());
    await persistState(state);
    return state.flashcards;
  }

  let notesMutationQueue = Promise.resolve();

  function queueNotesMutation(mutation) {
    const operation = notesMutationQueue.then(async () => {
      await ready;
      return mutation();
    });
    notesMutationQueue = operation.catch(() => {});
    return operation;
  }

  function getNotesState() {
    return readState().notes;
  }

  function noteSectionsForIds(sectionIds) {
    if (!Array.isArray(sectionIds)) return [...notesBank.sections];
    const selected = new Set(sectionIds.map(String));
    return notesBank.sections.filter(section => selected.has(section.id));
  }

  function notesMetrics(sectionIds, notesState) {
    const sections = noteSectionsForIds(sectionIds);
    const state = notesState?.sections && notesState?.subchapters
      ? notesState
      : getNotesState();
    const selectedSubchapterIds = new Set(sections.map(section => section.subchapterId));
    let viewed = 0;
    let completed = 0;
    let tested = 0;
    let correctAnswers = 0;
    let totalAnswers = 0;
    let sectionTestAttempts = 0;

    sections.forEach(section => {
      const record = state.sections[section.id];
      if (!record) return;
      if ((record.viewCount || 0) > 0) viewed += 1;
      if (Number.isFinite(record.completedAt)) completed += 1;
      if ((record.totalAnswers || 0) > 0) tested += 1;
      correctAnswers += Number.isInteger(record.correctAnswers) ? record.correctAnswers : 0;
      totalAnswers += Number.isInteger(record.totalAnswers) ? record.totalAnswers : 0;
      sectionTestAttempts += Number.isInteger(record.testAttempts) ? record.testAttempts : 0;
    });

    let startedSubchapters = 0;
    let completedSubchapters = 0;
    selectedSubchapterIds.forEach(subchapterId => {
      const subchapter = noteSubchapterById.get(subchapterId);
      if (!subchapter) return;
      const records = subchapter.sectionIds.map(sectionId => state.sections[sectionId]).filter(Boolean);
      if (records.some(record => (record.viewCount || 0) > 0 || (record.totalAnswers || 0) > 0 || Number.isFinite(record.completedAt))) {
        startedSubchapters += 1;
      }
      if (subchapter.sectionIds.length && subchapter.sectionIds.every(sectionId => Number.isFinite(state.sections[sectionId]?.completedAt))) {
        completedSubchapters += 1;
      }
    });

    const scopedTestRuns = selectedSubchapterIds.size === notesBank.subchapters.length
      ? state.testRuns
      : [...selectedSubchapterIds].reduce((sum, subchapterId) => sum + (state.subchapters[subchapterId]?.testAttempts || 0), 0);
    return {
      total: sections.length,
      viewed,
      completed,
      remaining: Math.max(0, sections.length - completed),
      tested,
      correctAnswers,
      totalAnswers,
      accuracy: totalAnswers ? Math.round((correctAnswers / totalAnswers) * 1000) / 10 : 0,
      coverage: sections.length ? Math.round((completed / sections.length) * 1000) / 10 : 0,
      sectionTestAttempts,
      testRuns: scopedTestRuns,
      totalSubchapters: selectedSubchapterIds.size,
      startedSubchapters,
      completedSubchapters
    };
  }

  function emptyNoteSectionRecord() {
    return {
      viewCount: 0,
      firstViewedAt: null,
      lastViewedAt: null,
      completedAt: null,
      testAttempts: 0,
      correctAnswers: 0,
      totalAnswers: 0,
      bestPercentage: 0,
      lastPercentage: null,
      lastTestedAt: null
    };
  }

  async function markNoteSectionViewed(sectionId) {
    const id = String(sectionId || "");
    if (!noteSectionById.has(id)) throw new Error("Secțiunea de notițe nu există.");
    return queueNotesMutation(async () => {
      const state = readState();
      const viewedAt = Date.now();
      const previous = { ...emptyNoteSectionRecord(), ...(state.notes.sections[id] || {}) };
      state.notes.sections[id] = {
        ...previous,
        viewCount: previous.viewCount + 1,
        firstViewedAt: previous.firstViewedAt || viewedAt,
        lastViewedAt: viewedAt
      };
      state.notes.updatedAt = viewedAt;
      await persistState(state);
      return state.notes.sections[id];
    });
  }

  async function setNoteSectionCompleted(sectionId, completed = true) {
    const id = String(sectionId || "");
    if (!noteSectionById.has(id)) throw new Error("Secțiunea de notițe nu există.");
    return queueNotesMutation(async () => {
      const state = readState();
      const changedAt = Date.now();
      const previous = { ...emptyNoteSectionRecord(), ...(state.notes.sections[id] || {}) };
      state.notes.sections[id] = {
        ...previous,
        completedAt: completed ? (previous.completedAt || changedAt) : null
      };
      state.notes.updatedAt = changedAt;
      await persistState(state);
      return state.notes.sections[id];
    });
  }

  async function recordNotesTest(testResult) {
    if (!isPlainObject(testResult) || !["section", "subchapter", "mistakes"].includes(testResult.scope)) {
      throw new Error("Rezultatul testului de completare este invalid.");
    }
    const subchapterId = String(testResult.subchapterId || "");
    if (!noteSubchapterById.has(subchapterId)) throw new Error("Subcapitolul testului de completare nu există.");
    if (!Array.isArray(testResult.results) || !testResult.results.length || testResult.results.length > 1000) {
      throw new Error("Testul de completare nu conține rezultate valide.");
    }

    return queueNotesMutation(async () => {
      const bySection = new Map();
      testResult.results.forEach(result => {
        const section = noteSectionById.get(String(result?.sectionId || ""));
        if (!section || section.subchapterId !== subchapterId || typeof result.correct !== "boolean") {
          throw new Error("Testul conține o completare invalidă.");
        }
        const cloze = section.clozes.find(item => item.id === result.clozeId);
        if (!cloze) throw new Error(`Completarea ${result.clozeId || "necunoscută"} nu există.`);
        const aggregate = bySection.get(section.id) || { correct: 0, total: 0 };
        aggregate.total += 1;
        aggregate.correct += result.correct ? 1 : 0;
        bySection.set(section.id, aggregate);
      });

      const state = readState();
      const testedAt = Date.now();
      bySection.forEach((result, sectionId) => {
        const previous = { ...emptyNoteSectionRecord(), ...(state.notes.sections[sectionId] || {}) };
        const percentage = Math.round((result.correct / result.total) * 1000) / 10;
        state.notes.sections[sectionId] = {
          ...previous,
          viewCount: Math.max(1, previous.viewCount),
          firstViewedAt: previous.firstViewedAt || testedAt,
          lastViewedAt: testedAt,
          completedAt: percentage === 100 ? (previous.completedAt || testedAt) : previous.completedAt,
          testAttempts: previous.testAttempts + 1,
          correctAnswers: previous.correctAnswers + result.correct,
          totalAnswers: previous.totalAnswers + result.total,
          bestPercentage: Math.max(previous.bestPercentage || 0, percentage),
          lastPercentage: percentage,
          lastTestedAt: testedAt
        };
      });

      const total = testResult.results.length;
      const correct = testResult.results.filter(result => result.correct).length;
      const percentage = Math.round((correct / total) * 1000) / 10;
      const previousSubchapter = state.notes.subchapters[subchapterId] || {
        testAttempts: 0,
        correctAnswers: 0,
        totalAnswers: 0,
        bestPercentage: 0,
        lastPercentage: null,
        lastTestedAt: null
      };
      state.notes.subchapters[subchapterId] = {
        ...previousSubchapter,
        testAttempts: previousSubchapter.testAttempts + 1,
        correctAnswers: previousSubchapter.correctAnswers + correct,
        totalAnswers: previousSubchapter.totalAnswers + total,
        bestPercentage: Math.max(previousSubchapter.bestPercentage || 0, percentage),
        lastPercentage: percentage,
        lastTestedAt: testedAt
      };
      state.notes.testRuns += 1;
      state.notes.updatedAt = testedAt;
      await persistState(state);
      return { correct, total, percentage, metrics: notesMetrics(undefined, state.notes) };
    });
  }

  async function resetNotesProgress() {
    return queueNotesMutation(async () => {
      const state = readState();
      state.notes = emptyNotes(Date.now());
      await persistState(state);
      return state.notes;
    });
  }

  function getProgress() {
    return readState().progress;
  }

  function recordProgress(state, question, scoredAnswer) {
    const progress = state.progress || emptyProgress();
    const previous = progress.questions[question.id] || {
      attempts: 0,
      correctAttempts: 0,
      wrongAttempts: 0
    };
    const answeredAt = Date.now();

    progress.questions[question.id] = {
      status: scoredAnswer.fullyCorrect ? "correct" : "wrong",
      attempts: previous.attempts + 1,
      correctAttempts: previous.correctAttempts + (scoredAnswer.fullyCorrect ? 1 : 0),
      wrongAttempts: previous.wrongAttempts + (scoredAnswer.fullyCorrect ? 0 : 1),
      lastScore: scoredAnswer.score,
      lastMaxScore: scoredAnswer.maxScore,
      lastAnsweredAt: answeredAt
    };
    progress.updatedAt = answeredAt;
    state.progress = progress;
    return progress;
  }

  function recordMistake(state, question, scoredAnswer) {
    const mistakes = normalizeMistakes(state.mistakes, state.progress);
    const previous = mistakes.questions[question.id];
    const answeredAt = Date.now();

    if (scoredAnswer.fullyCorrect) {
      if (previous) {
        mistakes.questions[question.id] = {
          ...previous,
          status: "mastered",
          resolvedAt: answeredAt
        };
        mistakes.updatedAt = answeredAt;
      }
    } else {
      mistakes.questions[question.id] = {
        status: "active",
        firstWrongAt: previous?.firstWrongAt || answeredAt,
        lastWrongAt: answeredAt,
        wrongAttempts: (Number.isInteger(previous?.wrongAttempts) ? previous.wrongAttempts : 0) + 1,
        resolvedAt: null
      };
      mistakes.updatedAt = answeredAt;
    }

    state.mistakes = mistakes;
    return mistakes;
  }

  async function resetProgress() {
    await ready;
    const state = readState();
    const emptyProgress = { version: 1, updatedAt: Date.now(), questions: {} };
    state.progress = emptyProgress;
    state.mistakes = emptyMistakes(emptyProgress.updatedAt);
    await persistState(state);
    return emptyProgress;
  }

  async function resetAllProgress() {
    return queueNotesMutation(async () => {
      const resetAt = Date.now();
      const state = readState();
      state.progress = emptyProgress(resetAt);
      state.mistakes = emptyMistakes(resetAt);
      state.flashcards = emptyFlashcards(resetAt);
      state.notes = emptyNotes(resetAt);
      state.history = [];
      state.session = null;
      await persistState(state);
      return {
        progress: state.progress,
        mistakes: state.mistakes,
        flashcards: state.flashcards,
        notes: state.notes,
        history: state.history,
        session: state.session
      };
    });
  }

  function metricsForQuestions(questions, progress = getProgress()) {
    let correct = 0;
    let wrong = 0;
    questions.forEach(question => {
      const status = progress.questions[question.id]?.status;
      if (status === "correct") correct += 1;
      else if (status === "wrong") wrong += 1;
    });
    return {
      total: questions.length,
      correct,
      wrong,
      remaining: questions.length - correct - wrong
    };
  }

  function metricsByCatalog() {
    const progress = getProgress();
    const subchapters = {};
    const chapters = {};

    bank.chapters.forEach(chapter => {
      const chapterQuestions = bank.questions.filter(question => question.chapterId === chapter.id);
      chapters[chapter.id] = metricsForQuestions(chapterQuestions, progress);
      chapter.subchapters.forEach(subchapter => {
        const questions = chapterQuestions.filter(question => question.subchapterId === subchapter.id);
        subchapters[subchapter.id] = metricsForQuestions(questions, progress);
      });
    });

    return { chapters, subchapters };
  }

  async function saveSession(session) {
    await ready;
    const state = readState();
    const previousSession = state.session;
    if (previousSession?.id !== session.id && previousSession?.status === "completed" && previousSession.result) {
      state.history = upsertHistoryEntry(state.history, buildHistoryEntry(previousSession));
    }
    const previousUpdatedAt = session.updatedAt;
    session.updatedAt = Date.now();
    state.session = cloneSerializable(session);
    try {
      await persistState(state);
    } catch (error) {
      session.updatedAt = previousUpdatedAt;
      throw error;
    }
    return session;
  }

  function getSession() {
    const session = readState().session;
    if (!session || session.version !== 1 || !Array.isArray(session.questionIds)) return null;
    const allQuestionsExist = session.questionIds.every(questionId => questionById.has(questionId));
    return allQuestionsExist ? session : null;
  }

  async function clearSession() {
    await ready;
    const state = readState();
    state.session = null;
    await persistState(state);
  }

  function setNextQuestion(session) {
    const nextQuestionId = session.pendingQuestionIds.shift() || null;
    session.currentQuestionId = nextQuestionId;
    if (nextQuestionId) {
      session.presented[nextQuestionId] = (session.presented[nextQuestionId] || 0) + 1;
    }
  }

  function cloneSerializable(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function restoreSerializable(target, snapshot) {
    Object.keys(target).forEach(key => delete target[key]);
    Object.assign(target, snapshot);
  }

  function finalizeSessionInMemory(session, reason) {
    if (session.status === "completed" && session.result) return session.result;
    session.status = "completed";
    session.completionReason = reason;
    session.completedAt = Date.now();
    session.updatedAt = session.completedAt;
    session.currentQuestionId = null;
    session.pendingQuestionIds = [];
    session.result = calculateResult(session);
    session.historySavedAt = session.completedAt;
    return session.result;
  }

  async function submitCurrentAnswer(session, rawSelection) {
    await ready;
    if (session.status !== "active" || !session.currentQuestionId) {
      throw new Error("Sesiunea nu are o întrebare activă.");
    }

    const question = questionById.get(session.currentQuestionId);
    const selection = normalizeSelection(rawSelection);
    if (question.type === "CS" && selection.length !== 1) {
      throw new Error("La întrebările CS trebuie selectat un singur răspuns.");
    }
    if (question.type === "CM" && selection.length === 0) {
      throw new Error("Selectează cel puțin un răspuns sau folosește «Mai târziu».");
    }

    const scoredAnswer = scoreQuestion(question, selection);
    const sessionSnapshot = cloneSerializable(session);
    const state = readState();

    try {
      recordProgress(state, question, scoredAnswer);
      recordMistake(state, question, scoredAnswer);
      session.answers[question.id] = selection;
      setNextQuestion(session);

      if (!session.currentQuestionId) {
        finalizeSessionInMemory(session, "answered");
        state.history = upsertHistoryEntry(state.history, buildHistoryEntry(session));
      } else {
        session.updatedAt = Date.now();
      }
      state.session = cloneSerializable(session);
      await persistState(state);
    } catch (error) {
      restoreSerializable(session, sessionSnapshot);
      throw error;
    }

    return scoredAnswer;
  }

  async function deferCurrentQuestion(session) {
    await ready;
    if (session.status !== "active" || !session.currentQuestionId) {
      throw new Error("Sesiunea nu are o întrebare activă.");
    }

    const sessionSnapshot = cloneSerializable(session);
    const deferredId = session.currentQuestionId;
    try {
      session.deferred[deferredId] = (session.deferred[deferredId] || 0) + 1;
      session.pendingQuestionIds.push(deferredId);
      setNextQuestion(session);
      session.updatedAt = Date.now();
      const state = readState();
      state.session = cloneSerializable(session);
      await persistState(state);
    } catch (error) {
      restoreSerializable(session, sessionSnapshot);
      throw error;
    }
    return session.currentQuestionId;
  }

  function calculateResult(session) {
    let score = 0;
    let maxScore = 0;
    let correctCount = 0;
    let answeredCount = 0;
    const details = session.questionIds.map(questionId => {
      const question = questionById.get(questionId);
      const hasAnswer = Object.hasOwn(session.answers, questionId);
      const scored = scoreQuestion(question, hasAnswer ? session.answers[questionId] : []);
      maxScore += scored.maxScore;
      score += scored.score;
      if (hasAnswer) answeredCount += 1;
      if (scored.fullyCorrect) correctCount += 1;
      return {
        questionId,
        answered: hasAnswer,
        selection: scored.selection,
        score: scored.score,
        maxScore: scored.maxScore,
        fullyCorrect: scored.fullyCorrect
      };
    });

    return {
      totalQuestions: session.questionIds.length,
      answeredCount,
      unansweredCount: session.questionIds.length - answeredCount,
      correctCount,
      wrongCount: answeredCount - correctCount,
      score,
      maxScore,
      percentage: maxScore ? Math.round((score / maxScore) * 1000) / 10 : 0,
      details
    };
  }

  function readHistory() {
    return readState().history;
  }

  function buildHistoryEntry(session) {
    if (!session?.id || session.status !== "completed" || !session.result) return null;
    const questions = session.result.details.map((detail, index) => {
      const question = questionById.get(detail.questionId);
      return {
        position: index + 1,
        questionId: question.id,
        fingerprint: question.fingerprint,
        type: question.type,
        chapterId: question.chapterId,
        subchapterId: question.subchapterId,
        correct: [...question.correct],
        selection: [...detail.selection],
        answered: detail.answered,
        fullyCorrect: detail.fullyCorrect,
        score: detail.score,
        maxScore: detail.maxScore
      };
    });
    return {
      id: session.id,
      mode: session.mode,
      createdAt: session.createdAt,
      completedAt: session.completedAt,
      totalQuestions: session.result.totalQuestions,
      answeredCount: session.result.answeredCount,
      unansweredCount: session.result.unansweredCount,
      correctCount: session.result.correctCount,
      wrongCount: session.result.wrongCount,
      score: session.result.score,
      maxScore: session.result.maxScore,
      percentage: session.result.percentage,
      completionReason: session.completionReason,
      durationSeconds: Math.max(0, Math.round((session.completedAt - session.createdAt) / 1000)),
      selectedSubchapterIds: [...(session.selectedSubchapterIds || [])],
      questions
    };
  }

  function upsertHistoryEntry(history, entry) {
    if (!entry) return history;
    return [entry, ...history.filter(item => item?.id !== entry.id)]
      .sort((left, right) => (right.completedAt || 0) - (left.completedAt || 0));
  }

  function getHistory() {
    const state = readState();
    const history = state.history;
    const storedSession = state.session;
    const entry = buildHistoryEntry(storedSession);
    if (!entry || history.some(item => item?.id === entry.id)) return history;
    return upsertHistoryEntry(history, entry);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function reportAnswerRows(question, optionIds, emptyText = "Fără răspuns") {
    if (!optionIds?.length) {
      return `<div class="answer-line is-empty">${escapeHtml(emptyText)}</div>`;
    }
    return optionIds.map(optionId => {
      const option = question.options.find(item => item.id === optionId);
      const stateClass = question.correct.includes(optionId) ? "is-correct" : "is-wrong";
      const stateLabel = question.correct.includes(optionId) ? "✓ Corect" : "× Greșit";
      return `<div class="answer-line ${stateClass}"><strong>${escapeHtml(optionId)}.</strong><span>${escapeHtml(option?.text || "")}</span><em>${stateLabel}</em></div>`;
    }).join("");
  }

  function buildResultReport(session) {
    if (!session?.result || session.status !== "completed") {
      throw new Error("Raportul poate fi generat doar pentru un test finalizat.");
    }

    const result = session.result;
    const modeLabel = session.mode === "exam"
      ? "Simulare examen național"
      : session.mode === "mistakes" ? "Test din grilele greșite" : "Test personalizat";
    const completedDate = new Date(session.completedAt || Date.now());
    const dateLabel = completedDate.toLocaleString("ro-RO", { dateStyle: "long", timeStyle: "short" });
    const fileStamp = completedDate.toISOString().replace(/[:.]/g, "-");
    const sessionStamp = String(session.id).replace(/[^a-z0-9-]/gi, "").slice(-8) || "rezultat";
    const reviewDetails = result.details.filter(detail => !detail.fullyCorrect);
    const summaryRows = result.details.map((detail, index) => {
      const question = questionById.get(detail.questionId);
      const chapter = chapterById.get(question.chapterId);
      const subchapter = subchapterById.get(question.subchapterId);
      const status = !detail.answered ? "Fără răspuns" : detail.fullyCorrect ? "Corect" : "Greșit";
      return `<tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(`${chapter.code} / ${subchapter.id}`)}</td>
        <td>${escapeHtml(question.type)}</td>
        <td class="status status-${detail.fullyCorrect ? "correct" : detail.answered ? "wrong" : "empty"}">${escapeHtml(status)}</td>
        <td>${detail.score} / ${detail.maxScore}</td>
      </tr>`;
    }).join("");
    const reviewHtml = reviewDetails.length
      ? reviewDetails.map((detail, index) => {
          const question = questionById.get(detail.questionId);
          const chapter = chapterById.get(question.chapterId);
          const subchapter = subchapterById.get(question.subchapterId);
          return `<article class="review-item">
            <div class="review-meta">${escapeHtml(`Cap. ${chapter.code} · ${subchapter.id} ${subchapter.title}`)} · ${detail.score}/${detail.maxScore} puncte</div>
            <h3>${index + 1}. ${escapeHtml(question.text)}</h3>
            <div class="answer-panel user-answer"><strong>Răspunsul Dianei</strong><div class="answer-lines">${reportAnswerRows(question, detail.selection)}</div></div>
            <div class="answer-panel correct-answer"><strong>Răspuns corect</strong><div class="answer-lines">${reportAnswerRows(question, question.correct, "—")}</div></div>
          </article>`;
        }).join("")
      : `<div class="perfect">Toate întrebările au fost rezolvate corect.</div>`;

    const html = `<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Rezultat ${escapeHtml(modeLabel)} — Grile Diana</title>
  <style>
    *{box-sizing:border-box}body{margin:0;background:#f3f7fa;color:#10243e;font-family:Arial,sans-serif;line-height:1.5}.page{width:min(980px,calc(100% - 32px));margin:32px auto}.hero{padding:36px;border-radius:22px;background:linear-gradient(120deg,#0a3655,#0d626f);color:#fff}.eyebrow{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#80ddd6}.hero h1{margin:8px 0 6px;font-size:34px}.hero p{margin:0;color:#c4dce2}.score-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:18px 0}.score-card,.section{padding:20px;border:1px solid #dce7ee;border-radius:16px;background:#fff}.score-card span{display:block;color:#64768a;font-size:12px}.score-card strong{display:block;margin-top:6px;font-size:27px}.section{margin-top:16px}.section h2{margin:0 0 16px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:10px;border-bottom:1px solid #e8eef2;text-align:left}.status{font-weight:700}.status-correct{color:#21815a}.status-wrong{color:#bd4c54}.status-empty{color:#a66c17}.review-item{margin-top:12px;padding:18px;border:1px solid #e1e9ef;border-left:4px solid #d86a73;border-radius:12px}.review-meta{color:#687b91;font-size:11px}.review-item h3{margin:8px 0 12px;font-size:15px}.answer-panel{margin-top:8px;padding:11px;border-radius:10px;background:#fff5f5}.answer-panel>strong{display:block;margin-bottom:7px;color:#873640;font-size:11px;text-transform:uppercase}.answer-panel.correct-answer{background:#eff9f3}.answer-panel.correct-answer>strong{color:#257057}.answer-lines{display:grid;gap:6px}.answer-line{display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:6px;padding:8px 9px;border-radius:8px;font-size:12px}.answer-line em{align-self:center;font-size:10px;font-style:normal;font-weight:700;white-space:nowrap}.answer-line.is-correct{background:#dff3e8;color:#216849}.answer-line.is-wrong{background:#ffe1e4;color:#963d47}.answer-line.is-empty{display:block;background:#f1f4f6;color:#6f7d8d}.perfect{padding:18px;border-radius:12px;background:#eff9f3;color:#247454;font-weight:700}.footer{padding:24px 0;color:#7a8b9d;font-size:11px;text-align:center}@media(max-width:650px){.score-grid{grid-template-columns:1fr}.hero{padding:26px}.hero h1{font-size:27px}.section{overflow-x:auto}}
  </style>
</head>
<body>
  <main class="page">
    <section class="hero">
      <span class="eyebrow">Grile Diana · ${escapeHtml(modeLabel)}</span>
      <h1>Rezultatul testului</h1>
      <p>${escapeHtml(dateLabel)}</p>
    </section>
    <section class="score-grid">
      <article class="score-card"><span>Întrebări corecte</span><strong>${result.correctCount} / ${result.totalQuestions}</strong></article>
      <article class="score-card"><span>Punctaj</span><strong>${result.score} / ${result.maxScore}</strong></article>
      <article class="score-card"><span>Procentaj</span><strong>${escapeHtml(result.percentage.toLocaleString("ro-RO"))}%</strong></article>
    </section>
    <section class="section">
      <h2>Sumarul întrebărilor</h2>
      <table><thead><tr><th>#</th><th>Materie</th><th>Tip</th><th>Rezultat</th><th>Punctaj</th></tr></thead><tbody>${summaryRows}</tbody></table>
    </section>
    <section class="section">
      <h2>Întrebări de revăzut (${reviewDetails.length})</h2>
      ${reviewHtml}
    </section>
    <footer class="footer">Raport generat local de Grile Diana. Fișierul poate fi păstrat sau tipărit în format PDF.</footer>
  </main>
</body>
</html>`;

    return {
      filename: `rezultat-${session.mode === "exam" ? "simulare" : session.mode === "mistakes" ? "greseli" : "test"}-${fileStamp}-${sessionStamp}.html`,
      mimeType: "text/html;charset=utf-8",
      contents: html
    };
  }

  function validateImportedProgress(progress) {
    if (!isPlainObject(progress) || progress.version !== 1 || !isPlainObject(progress.questions)) {
      throw new Error("Backupul nu conține un progres valid.");
    }
    if (Object.keys(progress.questions).length > 25000) {
      throw new Error("Backupul conține prea multe înregistrări de progres.");
    }
    Object.entries(progress.questions).forEach(([questionId, record]) => {
      if (!questionId || questionId.length > 250 || !isPlainObject(record)) {
        throw new Error("Backupul conține o înregistrare de progres invalidă.");
      }
      if (record.status !== "correct" && record.status !== "wrong") {
        throw new Error(`Statusul întrebării ${questionId} din backup este invalid.`);
      }
      ["attempts", "correctAttempts", "wrongAttempts"].forEach(field => {
        if (!Number.isInteger(record[field]) || record[field] < 0) {
          throw new Error(`Câmpul ${field} pentru întrebarea ${questionId} este invalid.`);
        }
      });
    });
    return cloneSerializable(progress);
  }

  function validateImportedMistakes(rawMistakes, progress, backupVersion) {
    if (backupVersion === 1 && rawMistakes === undefined) return mistakesFromProgress(progress);
    if (!isPlainObject(rawMistakes) || rawMistakes.version !== 1 || !isPlainObject(rawMistakes.questions)) {
      throw new Error("Backupul nu conține o listă validă de întrebări greșite.");
    }
    if (Object.keys(rawMistakes.questions).length > 25000) {
      throw new Error("Lista întrebărilor greșite din backup este prea mare.");
    }
    Object.entries(rawMistakes.questions).forEach(([questionId, record]) => {
      if (!questionId || questionId.length > 250 || !isPlainObject(record)) {
        throw new Error("Backupul conține o înregistrare invalidă în lista de greșeli.");
      }
      if (record.status !== "active" && record.status !== "mastered") {
        throw new Error(`Statusul greșelii pentru întrebarea ${questionId} este invalid.`);
      }
      if (!Number.isInteger(record.wrongAttempts) || record.wrongAttempts < 1) {
        throw new Error(`Numărul greșelilor pentru întrebarea ${questionId} este invalid.`);
      }
    });
    return cloneSerializable(rawMistakes);
  }

  function validateImportedHistory(rawHistory) {
    if (!Array.isArray(rawHistory) || rawHistory.length > 5000) {
      throw new Error("Istoricul din backup este invalid sau prea mare.");
    }
    const ids = new Set();
    rawHistory.forEach(entry => {
      if (!isPlainObject(entry) || typeof entry.id !== "string" || !entry.id || ids.has(entry.id)) {
        throw new Error("Backupul conține un test invalid sau duplicat în istoric.");
      }
      if (!["practice", "exam", "mistakes"].includes(entry.mode)) {
        throw new Error(`Tipul testului ${entry.id} din backup este invalid.`);
      }
      ids.add(entry.id);
    });
    return cloneSerializable(rawHistory);
  }

  function validateImportedSession(rawSession) {
    if (rawSession === null) return null;
    if (!isPlainObject(rawSession)
      || rawSession.version !== 1
      || typeof rawSession.id !== "string"
      || !rawSession.id
      || !["practice", "exam", "mistakes"].includes(rawSession.mode)
      || !["active", "completed"].includes(rawSession.status)
      || !Array.isArray(rawSession.questionIds)
      || !rawSession.questionIds.length) {
      throw new Error("Sesiunea din backup este invalidă.");
    }
    const unknownQuestion = rawSession.questionIds.find(questionId => !questionById.has(questionId));
    if (unknownQuestion) {
      throw new Error(`Backupul folosește întrebarea ${unknownQuestion}, care nu există în această versiune a aplicației.`);
    }
    return cloneSerializable(rawSession);
  }

  function validateImportedFlashcards(rawFlashcards, backupVersion) {
    if (backupVersion < 3 && rawFlashcards === undefined) return emptyFlashcards();
    if (!isPlainObject(rawFlashcards) || rawFlashcards.version !== 1 || !isPlainObject(rawFlashcards.ratings)) {
      throw new Error("Backupul nu conține un progres valid pentru flashcarduri.");
    }
    if (Object.keys(rawFlashcards.ratings).length > 20000) {
      throw new Error("Backupul conține prea multe evaluări de flashcarduri.");
    }
    Object.entries(rawFlashcards.ratings).forEach(([cardId, record]) => {
      if (!cardId || cardId.length > 250 || !isPlainObject(record)) {
        throw new Error("Backupul conține o evaluare de flashcard invalidă.");
      }
      if (!Number.isInteger(record.confidence) || record.confidence < 1 || record.confidence > 5) {
        throw new Error(`Nota flashcardului ${cardId} trebuie să fie între 1 și 5.`);
      }
      if (!Number.isInteger(record.reviews) || record.reviews < 1) {
        throw new Error(`Numărul recapitulărilor pentru flashcardul ${cardId} este invalid.`);
      }
      for (const field of ["firstSeenAt", "lastReviewedAt", "nextDueAt"]) {
        if (!Number.isFinite(record[field]) || record[field] < 0) {
          throw new Error(`${field} pentru flashcardul ${cardId} este invalid.`);
        }
      }
      if (!Number.isFinite(record.intervalMinutes) || record.intervalMinutes <= 0) {
        throw new Error(`Intervalul flashcardului ${cardId} este invalid.`);
      }
    });
    if (rawFlashcards.session !== null && rawFlashcards.session !== undefined) {
      const session = rawFlashcards.session;
      if (!isPlainObject(session)
        || session.version !== 1
        || typeof session.id !== "string"
        || !session.id
        || !["active", "completed"].includes(session.status)
        || !Array.isArray(session.deckIds)
        || !session.deckIds.every(deckId => typeof deckId === "string" && deckId)
        || !Array.isArray(session.queue)
        || !session.queue.every(cardId => typeof cardId === "string" && cardId)
        || !Number.isInteger(session.targetReviews)
        || session.targetReviews < 1
        || !Number.isInteger(session.reviewedCount)
        || session.reviewedCount < 0
        || session.reviewedCount > session.targetReviews
        || (session.currentCardId !== null && (typeof session.currentCardId !== "string" || !session.currentCardId))
        || !isPlainObject(session.uniqueSeen)
        || !isPlainObject(session.ratingCounts)) {
        throw new Error("Sesiunea de flashcarduri din backup este invalidă.");
      }
    }
    return cloneSerializable({ ...rawFlashcards, session: rawFlashcards.session || null });
  }

  function validateImportedNotes(rawNotes, backupVersion) {
    if (backupVersion < 4 && rawNotes === undefined) return emptyNotes();
    if (!isPlainObject(rawNotes)
      || rawNotes.version !== 1
      || !(rawNotes.updatedAt === null || (Number.isFinite(rawNotes.updatedAt) && rawNotes.updatedAt >= 0))
      || !Number.isInteger(rawNotes.testRuns)
      || rawNotes.testRuns < 0
      || !isPlainObject(rawNotes.sections)
      || !isPlainObject(rawNotes.subchapters)) {
      throw new Error("Backupul nu conține un progres valid pentru notițe.");
    }
    if (Object.keys(rawNotes.sections).length > 5000 || Object.keys(rawNotes.subchapters).length > 500) {
      throw new Error("Backupul conține prea multe înregistrări pentru notițe.");
    }
    const validTimestampOrNull = value => value === null || (Number.isFinite(value) && value >= 0);
    Object.entries(rawNotes.sections).forEach(([sectionId, record]) => {
      if (!noteSectionById.has(sectionId) || !isPlainObject(record)) {
        throw new Error(`Secțiunea ${sectionId || "necunoscută"} din backupul notițelor este invalidă.`);
      }
      for (const field of ["viewCount", "testAttempts", "correctAnswers", "totalAnswers"]) {
        if (!Number.isInteger(record[field]) || record[field] < 0) {
          throw new Error(`${field} pentru secțiunea ${sectionId} este invalid.`);
        }
      }
      for (const field of ["firstViewedAt", "lastViewedAt", "completedAt", "lastTestedAt"]) {
        if (!validTimestampOrNull(record[field])) throw new Error(`${field} pentru secțiunea ${sectionId} este invalid.`);
      }
      if (!Number.isFinite(record.bestPercentage) || record.bestPercentage < 0 || record.bestPercentage > 100) {
        throw new Error(`bestPercentage pentru secțiunea ${sectionId} este invalid.`);
      }
      if (record.lastPercentage !== null && (!Number.isFinite(record.lastPercentage) || record.lastPercentage < 0 || record.lastPercentage > 100)) {
        throw new Error(`lastPercentage pentru secțiunea ${sectionId} este invalid.`);
      }
    });
    Object.entries(rawNotes.subchapters).forEach(([subchapterId, record]) => {
      if (!noteSubchapterById.has(subchapterId) || !isPlainObject(record)) {
        throw new Error(`Subcapitolul ${subchapterId || "necunoscut"} din backupul notițelor este invalid.`);
      }
      for (const field of ["testAttempts", "correctAnswers", "totalAnswers"]) {
        if (!Number.isInteger(record[field]) || record[field] < 0) {
          throw new Error(`${field} pentru subcapitolul ${subchapterId} este invalid.`);
        }
      }
      if (!Number.isFinite(record.bestPercentage) || record.bestPercentage < 0 || record.bestPercentage > 100) {
        throw new Error(`bestPercentage pentru subcapitolul ${subchapterId} este invalid.`);
      }
      if (record.lastPercentage !== null && (!Number.isFinite(record.lastPercentage) || record.lastPercentage < 0 || record.lastPercentage > 100)) {
        throw new Error(`lastPercentage pentru subcapitolul ${subchapterId} este invalid.`);
      }
      if (!validTimestampOrNull(record.lastTestedAt)) throw new Error(`lastTestedAt pentru subcapitolul ${subchapterId} este invalid.`);
    });
    return cloneSerializable(rawNotes);
  }

  function parseProfileBackup(rawBackup) {
    let backup = rawBackup;
    if (typeof rawBackup === "string") {
      try {
        backup = JSON.parse(rawBackup);
      } catch {
        throw new Error("Fișierul selectat nu conține JSON valid.");
      }
    }
    if (!isPlainObject(backup) || backup.schema !== "grile-diana-profile") {
      throw new Error("Fișierul selectat nu este un backup Grile Diana.");
    }
    if (![1, 2, 3, 4].includes(backup.version)) {
      throw new Error(`Versiunea backupului (${backup.version ?? "necunoscută"}) nu este compatibilă.`);
    }
    return backup;
  }

  async function restoreProfileBackup(rawBackup) {
    await ready;
    const backup = parseProfileBackup(rawBackup);
    const progress = validateImportedProgress(backup.progress);
    const mistakes = validateImportedMistakes(backup.mistakes, progress, backup.version);
    const flashcards = validateImportedFlashcards(backup.flashcards, backup.version);
    const notes = validateImportedNotes(backup.notes, backup.version);
    const history = validateImportedHistory(backup.history);
    const session = validateImportedSession(backup.session ?? null);
    const state = readState();

    state.progress = progress;
    state.mistakes = mistakes;
    state.flashcards = flashcards;
    state.notes = notes;
    state.history = history;
    state.session = session;
    await persistState(state);

    return {
      progressCount: Object.keys(progress.questions).length,
      activeMistakes: Object.values(mistakes.questions).filter(record => record?.status === "active").length,
      flashcardStudied: Object.keys(flashcards.ratings).length,
      flashcardReviews: Object.values(flashcards.ratings).reduce((sum, record) => sum + (record.reviews || 0), 0),
      noteSectionsStudied: Object.values(notes.sections).filter(record => (record?.viewCount || 0) > 0).length,
      noteSectionsCompleted: Object.values(notes.sections).filter(record => Number.isFinite(record?.completedAt)).length,
      noteTestRuns: notes.testRuns,
      historyCount: history.length,
      hasSession: Boolean(session)
    };
  }

  function buildProfileBackup() {
    const exportedAt = Date.now();
    const state = readState();
    return {
      filename: `profil-diana-${new Date(exportedAt).toISOString().replace(/[:.]/g, "-")}.json`,
      mimeType: "application/json;charset=utf-8",
      contents: JSON.stringify({
        schema: "grile-diana-profile",
        version: 4,
        exportedAt,
        bankVersion: bank.version || bank.metadata?.generatedAt || null,
        flashcardBankVersion: flashcardBank.version || null,
        flashcardCardCount: flashcardBank.metadata?.cardCount || flashcardBank.cards.length,
        notesBankVersion: notesBank.version || null,
        notesSectionCount: notesBank.metadata?.sectionCount || notesBank.sections.length,
        progress: state.progress,
        mistakes: state.mistakes,
        flashcards: state.flashcards,
        notes: state.notes,
        history: getHistory(),
        session: state.session
      }, null, 2)
    };
  }

  async function completeSession(session, reason = "manual") {
    await ready;
    const sessionSnapshot = cloneSerializable(session);
    try {
      finalizeSessionInMemory(session, reason);
      session.historySavedAt = session.historySavedAt || Date.now();
      const state = readState();
      state.history = upsertHistoryEntry(state.history, buildHistoryEntry(session));
      state.session = cloneSerializable(session);
      await persistState(state);
    } catch (error) {
      restoreSerializable(session, sessionSnapshot);
      throw error;
    }
    return session.result;
  }

  function isFirstPassComplete(session) {
    return Object.keys(session.presented || {}).length >= session.questionIds.length;
  }

  function sessionStats(session) {
    const answered = Object.keys(session.answers || {}).length;
    return {
      total: session.questionIds.length,
      answered,
      unanswered: session.questionIds.length - answered,
      firstPassComplete: isFirstPassComplete(session),
      deferredCurrent: session.currentQuestionId ? session.deferred[session.currentQuestionId] || 0 : 0
    };
  }

  global.GrileApp = Object.freeze({
    ready,
    bank,
    questionById,
    chapterById,
    subchapterById,
    flashcardBank,
    flashcardById,
    flashcardDeckById,
    notesBank,
    noteSectionById,
    noteSubchapterById,
    scoreQuestion,
    calculateResult,
    availableQuestionsForSubchapters,
    createPracticeSession,
    createMistakeSession,
    createExamSession,
    createFlashcardSession,
    getFlashcardState,
    getFlashcardSession,
    flashcardsForDecks,
    flashcardMetrics,
    saveFlashcardSession,
    rateFlashcard,
    clearFlashcardSession,
    resetFlashcardProgress,
    getNotesState,
    notesMetrics,
    markNoteSectionViewed,
    setNoteSectionCompleted,
    recordNotesTest,
    resetNotesProgress,
    getProgress,
    getMistakes,
    mistakeQuestions,
    resetProgress,
    resetAllProgress,
    getHistory,
    metricsByCatalog,
    saveSession,
    getSession,
    clearSession,
    submitCurrentAnswer,
    deferCurrentQuestion,
    completeSession,
    buildResultReport,
    buildProfileBackup,
    restoreProfileBackup,
    isFirstPassComplete,
    sessionStats,
    normalizeSelection,
    uniqueQuestions
  });
})(typeof window !== "undefined" ? window : globalThis);
