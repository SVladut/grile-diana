(function initProfilePage(global) {
  "use strict";

  const PAGE_SIZE = 25;
  const bank = global.GRILE_QUESTION_BANK || { version: null, chapters: [], questions: [] };
  const chapters = Array.isArray(bank.chapters) ? bank.chapters : [];
  const questions = Array.isArray(bank.questions) ? bank.questions : [];
  const questionById = new Map(questions.map(question => [String(question.id), question]));
  const chapterById = new Map();
  const subchapterById = new Map();

  chapters.forEach(chapter => {
    chapterById.set(String(chapter.id), chapter);
    const subchapters = Array.isArray(chapter.subchapters) ? chapter.subchapters : [];
    subchapters.forEach(subchapter => {
      subchapterById.set(String(subchapter.id), {
        ...subchapter,
        chapterId: String(chapter.id)
      });
    });
  });

  const elements = {
    dataWarning: document.getElementById("dataWarning"),
    actionMessage: document.getElementById("actionMessage"),
    exportBackupBtn: document.getElementById("exportBackupBtn"),
    importBackupBtn: document.getElementById("importBackupBtn"),
    importBackupInput: document.getElementById("importBackupInput"),
    resetProgressBtn: document.getElementById("resetProgressBtn"),
    lastUpdateText: document.getElementById("lastUpdateText"),
    overviewSummary: document.getElementById("overviewSummary"),
    statTests: document.getElementById("statTests"),
    statBest: document.getElementById("statBest"),
    statAttempted: document.getElementById("statAttempted"),
    statCoverage: document.getElementById("statCoverage"),
    statCorrect: document.getElementById("statCorrect"),
    statAccuracy: document.getElementById("statAccuracy"),
    statAverage: document.getElementById("statAverage"),
    coverageHeadline: document.getElementById("coverageHeadline"),
    coveragePercent: document.getElementById("coveragePercent"),
    coverageBar: document.getElementById("coverageBar"),
    statRemaining: document.getElementById("statRemaining"),
    statWrong: document.getElementById("statWrong"),
    statTotalAttempts: document.getElementById("statTotalAttempts"),
    statCorrectAttempts: document.getElementById("statCorrectAttempts"),
    learningLastUpdate: document.getElementById("learningLastUpdate"),
    flashcardProgressHeadline: document.getElementById("flashcardProgressHeadline"),
    flashcardCoverage: document.getElementById("flashcardCoverage"),
    flashcardCoverageBar: document.getElementById("flashcardCoverageBar"),
    flashcardReviews: document.getElementById("flashcardReviews"),
    flashcardMastered: document.getElementById("flashcardMastered"),
    flashcardDue: document.getElementById("flashcardDue"),
    flashcardConfidence: document.getElementById("flashcardConfidence"),
    flashcardLastUpdate: document.getElementById("flashcardLastUpdate"),
    notesProgressHeadline: document.getElementById("notesProgressHeadline"),
    notesCoverage: document.getElementById("notesCoverage"),
    notesCoverageBar: document.getElementById("notesCoverageBar"),
    notesTested: document.getElementById("notesTested"),
    notesCorrectAnswers: document.getElementById("notesCorrectAnswers"),
    notesAccuracy: document.getElementById("notesAccuracy"),
    notesStartedSubchapters: document.getElementById("notesStartedSubchapters"),
    notesCompletedSubchapters: document.getElementById("notesCompletedSubchapters"),
    notesTestRuns: document.getElementById("notesTestRuns"),
    notesLastUpdate: document.getElementById("notesLastUpdate"),
    historyModeFilter: document.getElementById("historyModeFilter"),
    historySortFilter: document.getElementById("historySortFilter"),
    historyTableBody: document.getElementById("historyTableBody"),
    historyEmpty: document.getElementById("historyEmpty"),
    historyCount: document.getElementById("historyCount"),
    questionSearch: document.getElementById("questionSearch"),
    statusFilter: document.getElementById("statusFilter"),
    chapterFilter: document.getElementById("chapterFilter"),
    subchapterFilter: document.getElementById("subchapterFilter"),
    typeFilter: document.getElementById("typeFilter"),
    questionSortFilter: document.getElementById("questionSortFilter"),
    resetFiltersBtn: document.getElementById("resetFiltersBtn"),
    questionResultCount: document.getElementById("questionResultCount"),
    questionTableBody: document.getElementById("questionTableBody"),
    questionsEmpty: document.getElementById("questionsEmpty"),
    questionsEmptyTitle: document.getElementById("questionsEmptyTitle"),
    questionsEmptyText: document.getElementById("questionsEmptyText"),
    questionsEmptyLink: document.getElementById("questionsEmptyLink"),
    questionPagination: document.getElementById("questionPagination"),
    previousPageBtn: document.getElementById("previousPageBtn"),
    nextPageBtn: document.getElementById("nextPageBtn"),
    pageInfo: document.getElementById("pageInfo")
  };

  const numberFormatter = new Intl.NumberFormat("ro-RO");
  const decimalFormatter = new Intl.NumberFormat("ro-RO", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  });
  const dateFormatter = new Intl.DateTimeFormat("ro-RO", {
    dateStyle: "medium",
    timeStyle: "short"
  });

  let actionMessageTimer = null;
  let currentPage = 1;
  let app = null;
  let storedProgress = { version: 1, updatedAt: null, questions: {} };
  let storedSession = null;
  let storedFlashcards = { version: 1, updatedAt: null, ratings: {}, session: null };
  let storedNotes = { version: 1, updatedAt: null, sections: {}, subchapters: {}, testRuns: 0 };
  let flashcardStats = null;
  let notesStats = null;
  let progressQuestions = {};
  let history = [];
  let questionRows = [];

  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function nonNegativeInteger(value) {
    return Math.max(0, Math.trunc(finiteNumber(value, 0)));
  }

  function validTimestamp(value) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
  }

  function formatNumber(value) {
    return numberFormatter.format(nonNegativeInteger(value));
  }

  function formatDecimal(value) {
    return decimalFormatter.format(finiteNumber(value, 0));
  }

  function formatPercent(value) {
    return `${formatDecimal(value)}%`;
  }

  function formatDate(value) {
    const timestamp = validTimestamp(value);
    if (!timestamp) return "—";
    try {
      return dateFormatter.format(new Date(timestamp));
    } catch (error) {
      return "—";
    }
  }

  function normalizedSearchText(value) {
    const text = String(value || "").toLocaleLowerCase("ro-RO");
    try {
      return text.normalize("NFD").replace(/\p{Diacritic}/gu, "");
    } catch (error) {
      return text;
    }
  }

  function appendCell(row, label, value, className) {
    const cell = document.createElement("td");
    cell.dataset.label = label;
    if (className) cell.className = className;
    if (value instanceof global.Node) cell.append(value);
    else cell.textContent = String(value);
    row.append(cell);
    return cell;
  }

  function appendOption(select, value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
    return option;
  }

  function percentageFromHistory(entry) {
    const explicit = Number(entry?.percentage);
    if (Number.isFinite(explicit)) return Math.min(100, Math.max(0, explicit));
    const score = Number(entry?.score);
    const maxScore = Number(entry?.maxScore);
    return Number.isFinite(score) && Number.isFinite(maxScore) && maxScore > 0
      ? Math.min(100, Math.max(0, (score / maxScore) * 100))
      : null;
  }

  function buildQuestionRows() {
    return Object.entries(progressQuestions).reduce((rows, [questionId, rawRecord]) => {
      if (!rawRecord || typeof rawRecord !== "object") return rows;

      const question = questionById.get(String(questionId));
      const chapter = question ? chapterById.get(String(question.chapterId)) : null;
      const subchapter = question ? subchapterById.get(String(question.subchapterId)) : null;
      const attempts = nonNegativeInteger(rawRecord.attempts);
      const correctAttempts = nonNegativeInteger(rawRecord.correctAttempts);
      const wrongAttempts = nonNegativeInteger(rawRecord.wrongAttempts);
      const normalizedAttempts = Math.max(attempts, correctAttempts + wrongAttempts);
      const status = rawRecord.status === "correct" || rawRecord.status === "wrong"
        ? rawRecord.status
        : (finiteNumber(rawRecord.lastScore, -1) === finiteNumber(rawRecord.lastMaxScore, -2) ? "correct" : "wrong");
      const chapterTitle = chapter?.title || "Capitol indisponibil";
      const chapterCode = chapter?.code ? `Cap. ${chapter.code}` : "—";
      const subchapterTitle = subchapter?.title || "Subcapitol indisponibil";
      const subchapterId = String(question?.subchapterId || "—");
      const questionText = String(question?.text || "Întrebarea nu mai există în banca actuală.");
      const type = question?.type === "CS" || question?.type === "CM" ? question.type : "—";
      const lastScore = Number(rawRecord.lastScore);
      const lastMaxScore = Number(rawRecord.lastMaxScore);
      const hasScore = Number.isFinite(lastScore) && Number.isFinite(lastMaxScore) && lastMaxScore >= 0;
      const lastAnsweredAt = validTimestamp(rawRecord.lastAnsweredAt);
      const searchText = normalizedSearchText([
        questionId,
        questionText,
        chapterTitle,
        chapterCode,
        subchapterId,
        subchapterTitle,
        type
      ].join(" "));

      rows.push({
        id: String(questionId),
        questionText,
        type,
        chapterId: String(question?.chapterId || "unknown"),
        chapterCode,
        chapterTitle,
        subchapterId,
        subchapterTitle,
        status,
        attempts: normalizedAttempts,
        correctAttempts,
        wrongAttempts,
        lastScore: hasScore ? lastScore : null,
        lastMaxScore: hasScore ? lastMaxScore : null,
        lastAnsweredAt,
        existsInBank: Boolean(question),
        searchText
      });
      return rows;
    }, []);
  }

  function buildOverview() {
    const attemptedInBank = questionRows.filter(row => row.existsInBank).length;
    const totalQuestions = questions.length;
    const correct = questionRows.filter(row => row.status === "correct").length;
    const wrong = questionRows.filter(row => row.status === "wrong").length;
    const totalAttempts = questionRows.reduce((sum, row) => sum + row.attempts, 0);
    const correctAttempts = questionRows.reduce((sum, row) => sum + row.correctAttempts, 0);
    const remaining = Math.max(0, totalQuestions - attemptedInBank);
    const coverage = totalQuestions > 0 ? (attemptedInBank / totalQuestions) * 100 : 0;
    const accuracy = questionRows.length > 0 ? (correct / questionRows.length) * 100 : null;
    const grades = history.map(percentageFromHistory).filter(value => value !== null);
    const average = grades.length ? grades.reduce((sum, value) => sum + value, 0) / grades.length : null;
    const best = grades.length ? Math.max(...grades) : null;
    const lastActivity = Math.max(
      validTimestamp(storedProgress?.updatedAt) || 0,
      validTimestamp(storedFlashcards?.updatedAt) || 0,
      validTimestamp(storedNotes?.updatedAt) || 0,
      ...history.map(entry => validTimestamp(entry?.completedAt) || validTimestamp(entry?.createdAt) || 0)
    );

    elements.statTests.textContent = formatNumber(history.length);
    elements.statBest.textContent = best === null ? "Cel mai bun rezultat: —" : `Cel mai bun rezultat: ${formatPercent(best)}`;
    elements.statAttempted.textContent = formatNumber(attemptedInBank);
    elements.statCoverage.textContent = `${formatPercent(coverage)} din banca disponibilă`;
    elements.statCorrect.textContent = formatNumber(correct);
    elements.statAccuracy.textContent = accuracy === null ? "Acuratețe curentă: —" : `Acuratețe curentă: ${formatPercent(accuracy)}`;
    elements.statAverage.textContent = average === null ? "—" : formatPercent(average);
    elements.coverageHeadline.textContent = `${formatNumber(attemptedInBank)} din ${formatNumber(totalQuestions)} întrebări parcurse`;
    elements.coveragePercent.textContent = formatPercent(coverage);
    elements.coverageBar.style.width = `${Math.min(100, Math.max(0, coverage))}%`;
    elements.statRemaining.textContent = formatNumber(remaining);
    elements.statWrong.textContent = formatNumber(wrong);
    elements.statTotalAttempts.textContent = formatNumber(totalAttempts);
    elements.statCorrectAttempts.textContent = formatNumber(correctAttempts);
    elements.overviewSummary.textContent = history.length || questionRows.length
      ? `Ai ${formatNumber(totalAttempts)} încercări salvate pentru ${formatNumber(questionRows.length)} întrebări.`
      : "Statisticile se actualizează după fiecare răspuns.";
    elements.lastUpdateText.textContent = lastActivity > 0 ? `Actualizat ${formatDate(lastActivity)}` : "Nu există încă activitate";
  }

  function renderLearningActivity() {
    const flashcards = flashcardStats || {
      total: global.FLASHCARD_BANK?.cards?.length || 0,
      studied: 0,
      mastered: 0,
      due: 0,
      reviews: 0,
      averageConfidence: 0
    };
    const notes = notesStats || {
      total: global.NOTES_BANK?.sections?.length || 0,
      viewed: 0,
      completed: 0,
      tested: 0,
      correctAnswers: 0,
      totalAnswers: 0,
      accuracy: 0,
      coverage: 0,
      testRuns: 0,
      totalSubchapters: global.NOTES_BANK?.subchapters?.length || 0,
      startedSubchapters: 0,
      completedSubchapters: 0
    };

    const flashcardTotal = nonNegativeInteger(flashcards.total);
    const flashcardStudied = Math.min(flashcardTotal, nonNegativeInteger(flashcards.studied));
    const flashcardCoverage = flashcardTotal ? (flashcardStudied / flashcardTotal) * 100 : 0;
    const noteTotal = nonNegativeInteger(notes.total);
    const noteViewed = Math.min(noteTotal, nonNegativeInteger(notes.viewed));
    const noteCompleted = Math.min(noteTotal, nonNegativeInteger(notes.completed));
    const noteCoverage = Math.min(100, Math.max(0, finiteNumber(notes.coverage, 0)));
    const totalSubchapters = nonNegativeInteger(notes.totalSubchapters);
    const flashcardUpdatedAt = validTimestamp(storedFlashcards?.updatedAt);
    const notesUpdatedAt = validTimestamp(storedNotes?.updatedAt);
    const learningUpdatedAt = Math.max(flashcardUpdatedAt || 0, notesUpdatedAt || 0);

    elements.flashcardProgressHeadline.textContent = `${formatNumber(flashcardStudied)} din ${formatNumber(flashcardTotal)} parcurse`;
    elements.flashcardCoverage.textContent = `${formatPercent(flashcardCoverage)} acoperire`;
    elements.flashcardCoverageBar.style.width = `${Math.min(100, Math.max(0, flashcardCoverage))}%`;
    elements.flashcardReviews.textContent = formatNumber(flashcards.reviews);
    elements.flashcardMastered.textContent = formatNumber(flashcards.mastered);
    elements.flashcardDue.textContent = formatNumber(flashcards.due);
    elements.flashcardConfidence.textContent = flashcardStudied
      ? `${formatDecimal(flashcards.averageConfidence)} / 5`
      : "—";
    elements.flashcardLastUpdate.textContent = flashcardUpdatedAt
      ? `Ultima evaluare: ${formatDate(flashcardUpdatedAt)}`
      : "Nu ai evaluat încă niciun flashcard.";

    elements.notesProgressHeadline.textContent = `${formatNumber(noteViewed)} parcurse · ${formatNumber(noteCompleted)} din ${formatNumber(noteTotal)} completate`;
    elements.notesCoverage.textContent = `${formatPercent(noteCoverage)} acoperire`;
    elements.notesCoverageBar.style.width = `${noteCoverage}%`;
    elements.notesTested.textContent = formatNumber(notes.tested);
    elements.notesCorrectAnswers.textContent = `${formatNumber(notes.correctAnswers)} / ${formatNumber(notes.totalAnswers)}`;
    elements.notesAccuracy.textContent = nonNegativeInteger(notes.totalAnswers)
      ? formatPercent(notes.accuracy)
      : "—";
    elements.notesStartedSubchapters.textContent = `${formatNumber(notes.startedSubchapters)} / ${formatNumber(totalSubchapters)}`;
    elements.notesCompletedSubchapters.textContent = `${formatNumber(notes.completedSubchapters)} / ${formatNumber(totalSubchapters)}`;
    elements.notesTestRuns.textContent = formatNumber(notes.testRuns);
    elements.notesLastUpdate.textContent = notesUpdatedAt
      ? `Ultima activitate: ${formatDate(notesUpdatedAt)}`
      : "Nu ai parcurs încă nicio secțiune de notițe.";
    elements.learningLastUpdate.textContent = learningUpdatedAt
      ? `Ultima activitate: ${formatDate(learningUpdatedAt)}`
      : "Nicio activitate de învățare încă";
  }

  function populateChapterFilter() {
    chapters.forEach(chapter => {
      appendOption(
        elements.chapterFilter,
        String(chapter.id),
        `Cap. ${chapter.code || "—"} · ${chapter.title || "Fără titlu"}`
      );
    });
  }

  function populateSubchapterFilter() {
    const selectedChapter = elements.chapterFilter.value;
    const previousValue = elements.subchapterFilter.value;
    elements.subchapterFilter.replaceChildren();
    appendOption(elements.subchapterFilter, "all", "Toate subcapitolele");

    chapters
      .filter(chapter => selectedChapter === "all" || String(chapter.id) === selectedChapter)
      .forEach(chapter => {
        const subchapters = Array.isArray(chapter.subchapters) ? chapter.subchapters : [];
        subchapters.forEach(subchapter => {
          appendOption(
            elements.subchapterFilter,
            String(subchapter.id),
            `${subchapter.id} · ${subchapter.title || "Fără titlu"}`
          );
        });
      });

    const stillExists = [...elements.subchapterFilter.options].some(option => option.value === previousValue);
    elements.subchapterFilter.value = stillExists ? previousValue : "all";
  }

  function filteredHistory() {
    const mode = elements.historyModeFilter.value;
    const sort = elements.historySortFilter.value;
    const filtered = history.filter(entry => {
      if (!entry || typeof entry !== "object") return false;
      return mode === "all" || entry.mode === mode;
    });

    return filtered.sort((left, right) => {
      const leftDate = validTimestamp(left.completedAt) || validTimestamp(left.createdAt) || 0;
      const rightDate = validTimestamp(right.completedAt) || validTimestamp(right.createdAt) || 0;
      if (sort === "oldest") return leftDate - rightDate;
      if (sort === "best" || sort === "lowest") {
        const leftGrade = percentageFromHistory(left) ?? -1;
        const rightGrade = percentageFromHistory(right) ?? -1;
        return sort === "best" ? rightGrade - leftGrade : leftGrade - rightGrade;
      }
      return rightDate - leftDate;
    });
  }

  function renderHistory() {
    const filtered = filteredHistory();
    elements.historyTableBody.replaceChildren();
    elements.historyEmpty.hidden = filtered.length !== 0;
    elements.historyTableBody.parentElement.hidden = filtered.length === 0;

    filtered.forEach(entry => {
      const row = document.createElement("tr");
      const date = validTimestamp(entry.completedAt) || validTimestamp(entry.createdAt);
      appendCell(row, "Data", formatDate(date), "date-cell");

      const modeBadge = document.createElement("span");
      modeBadge.className = `mode-badge${entry.mode === "exam" ? " exam" : entry.mode === "mistakes" ? " mistakes" : ""}`;
      modeBadge.textContent = entry.mode === "exam"
        ? "Simulare examen"
        : entry.mode === "mistakes" ? "Test din greșeli" : "Test personalizat";
      appendCell(row, "Tip test", modeBadge);

      const totalQuestions = nonNegativeInteger(entry.totalQuestions);
      appendCell(row, "Întrebări", formatNumber(totalQuestions), "history-value");

      const correctCount = nonNegativeInteger(entry.correctCount);
      const correctWrapper = document.createElement("span");
      correctWrapper.className = "history-value";
      const correctStrong = document.createElement("strong");
      correctStrong.textContent = formatNumber(correctCount);
      correctWrapper.append(correctStrong);
      if (totalQuestions > 0) {
        const correctSmall = document.createElement("small");
        correctSmall.textContent = ` / ${formatNumber(totalQuestions)}`;
        correctWrapper.append(correctSmall);
      }
      appendCell(row, "Corecte", correctWrapper);

      const score = Number(entry.score);
      const maxScore = Number(entry.maxScore);
      const points = Number.isFinite(score) && Number.isFinite(maxScore)
        ? `${formatDecimal(score)} / ${formatDecimal(maxScore)}`
        : "—";
      appendCell(row, "Punctaj", points, "history-value");

      const grade = percentageFromHistory(entry);
      const gradeWrapper = document.createElement("span");
      const gradeClass = grade === null ? "" : grade >= 70 ? " grade-high" : grade < 50 ? " grade-low" : "";
      gradeWrapper.className = `grade-cell${gradeClass}`;
      const gradeStrong = document.createElement("strong");
      gradeStrong.className = gradeClass.trim();
      gradeStrong.textContent = grade === null ? "—" : formatPercent(grade);
      gradeWrapper.append(gradeStrong);
      appendCell(row, "Notă", gradeWrapper);

      elements.historyTableBody.append(row);
    });

    if (!history.length) {
      elements.historyCount.textContent = "Niciun test salvat";
    } else if (filtered.length === history.length) {
      elements.historyCount.textContent = `${formatNumber(filtered.length)} ${filtered.length === 1 ? "test salvat" : "teste salvate"}`;
    } else {
      elements.historyCount.textContent = `${formatNumber(filtered.length)} din ${formatNumber(history.length)} teste afișate`;
    }
  }

  function filteredQuestionRows() {
    const query = normalizedSearchText(elements.questionSearch.value.trim());
    const status = elements.statusFilter.value;
    const chapterId = elements.chapterFilter.value;
    const subchapterId = elements.subchapterFilter.value;
    const type = elements.typeFilter.value;
    const sort = elements.questionSortFilter.value;

    const filtered = questionRows.filter(row => {
      if (query && !row.searchText.includes(query)) return false;
      if (status !== "all" && row.status !== status) return false;
      if (chapterId !== "all" && row.chapterId !== chapterId) return false;
      if (subchapterId !== "all" && row.subchapterId !== subchapterId) return false;
      if (type !== "all" && row.type !== type) return false;
      return true;
    });

    return filtered.sort((left, right) => {
      if (sort === "oldest") return (left.lastAnsweredAt || 0) - (right.lastAnsweredAt || 0);
      if (sort === "attempts") return right.attempts - left.attempts || (right.lastAnsweredAt || 0) - (left.lastAnsweredAt || 0);
      if (sort === "wrong") return right.wrongAttempts - left.wrongAttempts || right.attempts - left.attempts;
      if (sort === "id") return left.id.localeCompare(right.id, "ro", { numeric: true });
      return (right.lastAnsweredAt || 0) - (left.lastAnsweredAt || 0);
    });
  }

  function createQuestionIdentity(rowData) {
    const wrapper = document.createElement("div");
    const head = document.createElement("div");
    head.className = "question-cell-head";

    const id = document.createElement("strong");
    id.className = "question-id";
    id.textContent = rowData.id;
    head.append(id);

    const type = document.createElement("span");
    type.className = `type-pill${rowData.type === "CM" ? " cm" : ""}`;
    type.textContent = rowData.type;
    head.append(type);

    const preview = document.createElement("span");
    preview.className = "question-preview";
    preview.textContent = rowData.questionText;
    preview.title = rowData.questionText;
    wrapper.append(head, preview);
    return wrapper;
  }

  function createChapterIdentity(mainText, secondaryText) {
    const wrapper = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = mainText;
    const small = document.createElement("small");
    small.textContent = secondaryText;
    wrapper.append(strong, small);
    return wrapper;
  }

  function renderQuestionRow(rowData) {
    const row = document.createElement("tr");
    appendCell(row, "Întrebare", createQuestionIdentity(rowData), "question-cell");
    appendCell(row, "Capitol", createChapterIdentity(rowData.chapterCode, rowData.chapterTitle), "chapter-cell");
    appendCell(row, "Subcapitol", createChapterIdentity(rowData.subchapterId, rowData.subchapterTitle), "subchapter-cell");

    const status = document.createElement("span");
    status.className = `status-badge ${rowData.status}`;
    status.textContent = rowData.status === "correct" ? "Corectă" : "Greșită";
    appendCell(row, "Status", status);

    appendCell(row, "Încercări", formatNumber(rowData.attempts), "number-cell");
    appendCell(row, "Corecte", formatNumber(rowData.correctAttempts), "number-cell good");
    appendCell(row, "Greșite", formatNumber(rowData.wrongAttempts), "number-cell bad");

    const score = document.createElement("span");
    const perfect = rowData.lastScore !== null && rowData.lastMaxScore !== null && rowData.lastScore === rowData.lastMaxScore;
    score.className = `score-badge${perfect ? " perfect" : ""}`;
    score.textContent = rowData.lastScore === null || rowData.lastMaxScore === null
      ? "—"
      : `${formatDecimal(rowData.lastScore)} / ${formatDecimal(rowData.lastMaxScore)}`;
    appendCell(row, "Ultimul punctaj", score);
    appendCell(row, "Data", formatDate(rowData.lastAnsweredAt), "date-cell");
    return row;
  }

  function hasActiveQuestionFilters() {
    return Boolean(elements.questionSearch.value.trim())
      || elements.statusFilter.value !== "all"
      || elements.chapterFilter.value !== "all"
      || elements.subchapterFilter.value !== "all"
      || elements.typeFilter.value !== "all";
  }

  function renderQuestions() {
    const filtered = filteredQuestionRows();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    const visible = filtered.slice(startIndex, startIndex + PAGE_SIZE);

    elements.questionTableBody.replaceChildren();
    visible.forEach(row => elements.questionTableBody.append(renderQuestionRow(row)));

    const noResults = filtered.length === 0;
    elements.questionsEmpty.hidden = !noResults;
    elements.questionTableBody.parentElement.hidden = noResults;
    if (noResults && hasActiveQuestionFilters()) {
      elements.questionsEmptyTitle.textContent = "Nicio întrebare nu corespunde filtrelor";
      elements.questionsEmptyText.textContent = "Modifică termenul de căutare sau resetează filtrele pentru a vedea toate rezultatele.";
      elements.questionsEmptyLink.hidden = true;
    } else if (noResults) {
      elements.questionsEmptyTitle.textContent = "Nicio întrebare parcursă încă";
      elements.questionsEmptyText.textContent = "Rezolvă primul test pentru a începe să construiești statisticile.";
      elements.questionsEmptyLink.hidden = false;
    }

    if (questionRows.length === 0) {
      elements.questionResultCount.textContent = "Nicio întrebare parcursă";
    } else if (filtered.length === questionRows.length) {
      elements.questionResultCount.textContent = `${formatNumber(filtered.length)} ${filtered.length === 1 ? "întrebare parcursă" : "întrebări parcurse"}`;
    } else {
      elements.questionResultCount.textContent = `${formatNumber(filtered.length)} din ${formatNumber(questionRows.length)} întrebări`;
    }

    elements.questionPagination.hidden = filtered.length <= PAGE_SIZE;
    elements.previousPageBtn.disabled = currentPage <= 1;
    elements.nextPageBtn.disabled = currentPage >= totalPages;
    elements.pageInfo.textContent = `Pagina ${formatNumber(currentPage)} din ${formatNumber(totalPages)}`;
  }

  function resetQuestionFilters() {
    elements.questionSearch.value = "";
    elements.statusFilter.value = "all";
    elements.chapterFilter.value = "all";
    populateSubchapterFilter();
    elements.subchapterFilter.value = "all";
    elements.typeFilter.value = "all";
    elements.questionSortFilter.value = "recent";
    currentPage = 1;
    renderQuestions();
  }

  function showActionMessage(message, isError = false) {
    if (actionMessageTimer) global.clearTimeout(actionMessageTimer);
    elements.actionMessage.textContent = message;
    elements.actionMessage.hidden = false;
    if (isError) {
      elements.actionMessage.style.background = "var(--red-pale)";
      elements.actionMessage.style.borderColor = "#f0c4c8";
      elements.actionMessage.style.color = "#93404a";
    } else {
      elements.actionMessage.style.background = "var(--green-pale)";
      elements.actionMessage.style.borderColor = "#bde3d0";
      elements.actionMessage.style.color = "#176b49";
    }
    actionMessageTimer = global.setTimeout(() => {
      elements.actionMessage.hidden = true;
    }, 5000);
  }

  async function exportBackup() {
    try {
      const exportedAt = new Date();
      if (!app?.buildProfileBackup) throw new Error("Motorul de backup nu este disponibil.");
      const backup = await app.buildProfileBackup();
      const contents = typeof backup?.contents === "string"
        ? backup.contents
        : JSON.stringify(backup, null, 2);
      const mimeType = typeof backup?.mimeType === "string"
        ? backup.mimeType
        : "application/json;charset=utf-8";
      const filename = typeof backup?.filename === "string" && backup.filename.trim()
        ? backup.filename
        : `grile-diana-backup-${exportedAt.toISOString().slice(0, 10)}.json`;
      const blob = new Blob([contents], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const download = document.createElement("a");
      download.href = url;
      download.download = filename;
      download.hidden = true;
      document.body.append(download);
      download.click();
      download.remove();
      global.setTimeout(() => URL.revokeObjectURL(url), 1000);
      showActionMessage("Backupul v4 a fost descărcat: include grilele, greșelile, flashcardurile, notițele și testele cu completări.");
    } catch (error) {
      console.error("Backupul nu a putut fi exportat.", error);
      showActionMessage("Backupul nu a putut fi descărcat. Încearcă din nou.", true);
    }
  }

  async function importBackup() {
    const file = elements.importBackupInput.files?.[0];
    if (!file) return;
    if (file.size > 64 * 1024 * 1024) {
      showActionMessage("Fișierul este prea mare. Backupul poate avea cel mult 64 MB.", true);
      elements.importBackupInput.value = "";
      return;
    }

    const confirmed = global.confirm(
      "Importul va înlocui progresul, lista de greșeli, flashcardurile, notițele, testele cu completări, istoricul și sesiunile curente cu datele din backup. Continui?"
    );
    if (!confirmed) {
      elements.importBackupInput.value = "";
      return;
    }

    const originalContents = elements.importBackupBtn.innerHTML;
    elements.importBackupBtn.disabled = true;
    elements.exportBackupBtn.disabled = true;
    elements.importBackupBtn.textContent = "Se importă…";
    try {
      if (!app?.restoreProfileBackup) throw new Error("Motorul de import nu este disponibil.");
      const summary = await app.restoreProfileBackup(await file.text());
      refreshDataFromApp();
      renderAllData();
      const mistakeText = summary.activeMistakes === 1
        ? "1 grilă greșită activă"
        : `${formatNumber(summary.activeMistakes)} grile greșite active`;
      const flashcardText = summary.flashcardStudied === 1
        ? "1 flashcard parcurs"
        : `${formatNumber(summary.flashcardStudied)} flashcarduri parcurse`;
      const noteSectionsStudied = nonNegativeInteger(summary.noteSectionsStudied);
      const noteSectionsCompleted = nonNegativeInteger(summary.noteSectionsCompleted);
      const noteTestRuns = nonNegativeInteger(summary.noteTestRuns);
      const notesText = `${formatNumber(noteSectionsStudied)} secțiuni de notițe parcurse, ${formatNumber(noteSectionsCompleted)} completate și ${formatNumber(noteTestRuns)} teste de notițe`;
      showActionMessage(`Backup v4 importat cu succes: ${formatNumber(summary.progressCount)} întrebări, ${mistakeText}, ${flashcardText} și ${notesText}.`);
    } catch (error) {
      console.error("Backupul nu a putut fi importat.", error);
      showActionMessage(error.message || "Backupul nu a putut fi importat.", true);
    } finally {
      elements.importBackupInput.value = "";
      elements.importBackupBtn.disabled = false;
      elements.exportBackupBtn.disabled = false;
      elements.importBackupBtn.innerHTML = originalContents;
    }
  }

  function refreshDataFromApp() {
    const nextProgress = app?.getProgress?.();
    const nextHistory = app?.getHistory?.();
    const nextSession = app?.getSession?.();
    const nextFlashcards = app?.getFlashcardState?.();
    const nextNotes = app?.getNotesState?.();
    storedProgress = nextProgress && typeof nextProgress === "object"
      ? nextProgress
      : { version: 1, updatedAt: null, questions: {} };
    storedSession = nextSession || null;
    storedFlashcards = nextFlashcards && typeof nextFlashcards === "object"
      ? nextFlashcards
      : { version: 1, updatedAt: null, ratings: {}, session: null };
    storedNotes = nextNotes && typeof nextNotes === "object"
      ? nextNotes
      : { version: 1, updatedAt: null, sections: {}, subchapters: {}, testRuns: 0 };
    flashcardStats = typeof app?.flashcardMetrics === "function" ? app.flashcardMetrics() : null;
    notesStats = typeof app?.notesMetrics === "function" ? app.notesMetrics() : null;
    progressQuestions = storedProgress.questions && typeof storedProgress.questions === "object" && !Array.isArray(storedProgress.questions)
      ? storedProgress.questions
      : {};
    history = Array.isArray(nextHistory) ? nextHistory : [];
    questionRows = buildQuestionRows();
  }

  function renderAllData() {
    currentPage = 1;
    buildOverview();
    renderLearningActivity();
    renderHistory();
    renderQuestions();
  }

  async function resetAllProgress() {
    const confirmed = global.confirm(
      "Resetezi TOT progresul?\n\nSe vor șterge statisticile grilelor, lista întrebărilor greșite, istoricul și testul în desfășurare, progresul la flashcarduri și progresul la notițe. Această acțiune nu poate fi anulată."
    );
    if (!confirmed) return;

    const originalLabel = elements.resetProgressBtn.textContent;
    elements.resetProgressBtn.disabled = true;
    elements.resetProgressBtn.textContent = "Se resetează…";
    try {
      if (!app?.resetAllProgress) throw new Error("Resetarea completă nu este disponibilă.");
      await app.resetAllProgress();
      refreshDataFromApp();
      renderAllData();
      showActionMessage("Tot progresul a fost resetat: grile, întrebări greșite, istoric, flashcarduri și notițe.");
    } catch (error) {
      console.error("Progresul nu a putut fi resetat.", error);
      showActionMessage("Progresul nu a putut fi resetat. Încearcă din nou.", true);
    } finally {
      elements.resetProgressBtn.disabled = false;
      elements.resetProgressBtn.textContent = originalLabel;
    }
  }

  function bindEvents() {
    elements.exportBackupBtn.addEventListener("click", exportBackup);
    elements.importBackupBtn.addEventListener("click", () => elements.importBackupInput.click());
    elements.importBackupInput.addEventListener("change", importBackup);
    elements.resetProgressBtn.addEventListener("click", resetAllProgress);
    elements.historyModeFilter.addEventListener("change", renderHistory);
    elements.historySortFilter.addEventListener("change", renderHistory);
    elements.questionSearch.addEventListener("input", () => {
      currentPage = 1;
      renderQuestions();
    });
    elements.statusFilter.addEventListener("change", () => {
      currentPage = 1;
      renderQuestions();
    });
    elements.chapterFilter.addEventListener("change", () => {
      populateSubchapterFilter();
      currentPage = 1;
      renderQuestions();
    });
    elements.subchapterFilter.addEventListener("change", () => {
      currentPage = 1;
      renderQuestions();
    });
    elements.typeFilter.addEventListener("change", () => {
      currentPage = 1;
      renderQuestions();
    });
    elements.questionSortFilter.addEventListener("change", () => {
      currentPage = 1;
      renderQuestions();
    });
    elements.resetFiltersBtn.addEventListener("click", resetQuestionFilters);
    elements.previousPageBtn.addEventListener("click", () => {
      if (currentPage <= 1) return;
      currentPage -= 1;
      renderQuestions();
      document.getElementById("questions-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    elements.nextPageBtn.addEventListener("click", () => {
      currentPage += 1;
      renderQuestions();
      document.getElementById("questions-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function init() {
    try {
      app = global.GrileApp;
      if (!app) throw new Error("Motorul aplicației nu a fost încărcat.");
      await app.ready;
      refreshDataFromApp();
    } catch (error) {
      console.error("Profilul nu a putut încărca datele aplicației.", error);
      elements.dataWarning.textContent = "Datele profilului nu au putut fi încărcate din fișier. Reîncarcă pagina și încearcă din nou.";
      elements.dataWarning.hidden = false;
      elements.exportBackupBtn.disabled = true;
      elements.importBackupBtn.disabled = true;
      elements.resetProgressBtn.disabled = true;
    }

    if (!questions.length) {
      elements.dataWarning.textContent = "Banca de întrebări nu a putut fi încărcată. Istoricul este afișat, dar denumirile întrebărilor pot lipsi.";
      elements.dataWarning.hidden = false;
    }

    populateChapterFilter();
    populateSubchapterFilter();
    if (new URLSearchParams(global.location.search).get("status") === "wrong") {
      elements.statusFilter.value = "wrong";
    }
    renderAllData();
    bindEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : globalThis);
