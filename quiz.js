"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const app = window.GrileApp;
  let session = null;
  let timerInterval = null;
  let toastTimeout = null;
  let actionPending = false;
  let awaitingNext = false;

  const quizView = document.getElementById("quizView");
  const resultView = document.getElementById("resultView");
  const errorView = document.getElementById("errorView");
  const errorMessage = document.getElementById("errorMessage");
  const sessionMode = document.getElementById("sessionMode");
  const progressLabel = document.getElementById("progressLabel");
  const progressBar = document.getElementById("progressBar");
  const timerPanel = document.getElementById("timerPanel");
  const timer = document.getElementById("timer");
  const chapterLabel = document.getElementById("chapterLabel");
  const contextSeparator = document.getElementById("contextSeparator");
  const subchapterLabel = document.getElementById("subchapterLabel");
  const pageSeparator = document.getElementById("pageSeparator");
  const pageLabel = document.getElementById("pageLabel");
  const questionType = document.getElementById("questionType");
  const questionNumber = document.getElementById("questionNumber");
  const questionText = document.getElementById("questionText");
  const answerInstruction = document.getElementById("answerInstruction");
  const answerForm = document.getElementById("answerForm");
  const answersList = document.getElementById("answersList");
  const selectionWarning = document.getElementById("selectionWarning");
  const answerFeedback = document.getElementById("answerFeedback");
  const feedbackIcon = document.getElementById("feedbackIcon");
  const feedbackTitle = document.getElementById("feedbackTitle");
  const feedbackPoints = document.getElementById("feedbackPoints");
  const selectedAnswerFeedback = document.getElementById("selectedAnswerFeedback");
  const selectedAnswerList = document.getElementById("selectedAnswerList");
  const correctAnswerFeedback = document.getElementById("correctAnswerFeedback");
  const correctAnswerText = document.getElementById("correctAnswerText");
  const deferBtn = document.getElementById("deferBtn");
  const answerBtn = document.getElementById("answerBtn");
  const nextBtn = document.getElementById("nextBtn");
  const nextBtnLabel = document.getElementById("nextBtnLabel");
  const answeredStat = document.getElementById("answeredStat");
  const pendingStat = document.getElementById("pendingStat");
  const deferredStat = document.getElementById("deferredStat");
  const reviewNotice = document.getElementById("reviewNotice");
  const finishBtn = document.getElementById("finishBtn");
  const downloadResultBtn = document.getElementById("downloadResultBtn");
  const resultFileStatus = document.getElementById("resultFileStatus");
  const toast = document.getElementById("toast");

  function showOnly(view) {
    [quizView, resultView, errorView].forEach(section => {
      section.hidden = section !== view;
    });
  }

  function showError(message) {
    clearInterval(timerInterval);
    errorMessage.textContent = message;
    showOnly(errorView);
  }

  function showToast(message) {
    clearTimeout(toastTimeout);
    toast.textContent = message;
    toast.hidden = false;
    toastTimeout = setTimeout(() => {
      toast.hidden = true;
    }, 2600);
  }

  function triggerDownload(file) {
    if (typeof Blob === "undefined" || !window.URL?.createObjectURL) return false;

    const blob = new Blob([file.contents], { type: file.mimeType });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.filename;
    link.hidden = true;
    document.body.append(link);

    try {
      link.click();
      return true;
    } finally {
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    }
  }

  function downloadResultReport() {
    try {
      const started = triggerDownload(app.buildResultReport(session));
      if (!started) {
        resultFileStatus.textContent = "Browserul nu poate porni descărcarea. Rezultatul rămâne disponibil în profil.";
        showToast("Descărcarea nu este disponibilă în acest browser.");
        return false;
      }

      session.resultDownloadTriggeredAt = session.resultDownloadTriggeredAt || Date.now();
      app.saveSession(session).catch(error => {
        console.warn("Marcajul descărcării nu a putut fi salvat.", error);
      });
      resultFileStatus.textContent = "Descărcarea raportului a fost pornită. Îl vei găsi în descărcările browserului.";
      showToast("Raportul rezultatului a fost pregătit pentru descărcare.");
      return true;
    } catch (error) {
      resultFileStatus.textContent = "Raportul nu a putut fi generat. Rezultatul este în continuare păstrat în profil.";
      showToast(error.message);
      return false;
    }
  }

  function selectedOptions() {
    return [...answersList.querySelectorAll('input[name="answer"]:checked')].map(input => input.value);
  }

  function updateAnswerState(question) {
    const selected = selectedOptions();
    answerBtn.disabled = question.type === "CS" ? selected.length !== 1 : selected.length === 0;
    const allSelected = question.type === "CM" && selected.length === 5;
    selectionWarning.hidden = !allSelected;
    selectionWarning.textContent = allSelected
      ? "Ai selectat toate cele 5 variante. Conform regulii de examen, această alegere valorează 0 puncte."
      : "";
  }

  function createAnswerOption(question, option) {
    const label = document.createElement("label");
    label.className = "answer-option";

    const input = document.createElement("input");
    input.type = question.type === "CS" ? "radio" : "checkbox";
    input.name = "answer";
    input.value = option.id;

    const letter = document.createElement("span");
    letter.className = "option-letter";
    letter.textContent = option.id;

    const text = document.createElement("span");
    text.className = "option-text";
    text.textContent = option.text;

    const resultStatus = document.createElement("span");
    resultStatus.className = "option-result";
    resultStatus.hidden = true;

    label.append(input, letter, text, resultStatus);
    return label;
  }

  function renderSessionProgress() {
    const stats = app.sessionStats(session);
    const totalDeferrals = Object.values(session.deferred || {}).reduce((sum, count) => sum + count, 0);

    progressLabel.textContent = `${stats.answered} din ${stats.total} rezolvate`;
    progressBar.style.width = `${(stats.answered / stats.total) * 100}%`;
    answeredStat.textContent = String(stats.answered);
    pendingStat.textContent = String(stats.unanswered);
    deferredStat.textContent = String(totalDeferrals);
    reviewNotice.hidden = !stats.firstPassComplete || stats.unanswered === 0;
    finishBtn.hidden = !stats.firstPassComplete || stats.unanswered === 0;
    finishBtn.textContent = `Finalizează cu ${stats.unanswered} ${stats.unanswered === 1 ? "întrebare" : "întrebări"} fără răspuns`;
    return stats;
  }

  function renderActiveQuestion() {
    if (!session?.currentQuestionId) {
      showError("Sesiunea nu conține o întrebare activă.");
      return;
    }

    const question = app.questionById.get(session.currentQuestionId);
    const chapter = app.chapterById.get(question.chapterId);
    const subchapter = app.subchapterById.get(question.subchapterId);
    const stats = renderSessionProgress();
    const originalIndex = session.questionIds.indexOf(question.id) + 1;

    showOnly(quizView);
    sessionMode.textContent = session.mode === "exam"
      ? "Simulare examen național"
      : session.mode === "mistakes" ? "Recapitulare grile greșite" : "Test personalizat";

    const importedSubject = question.source === "subiecte-2021-2025";
    const importedHistorical = question.source === "grile-anterioare";
    const importedSet2 = question.source === "set-2";
    const hasPages = (importedSubject || importedHistorical || importedSet2) && Array.isArray(question.pages) && question.pages.length > 0;
    chapterLabel.textContent = importedSubject
      ? subchapter.title
      : `Cap. ${chapter.code} · ${chapter.title}`;
    contextSeparator.textContent = importedSubject ? "•" : "/";
    subchapterLabel.textContent = importedSubject
      ? chapter.title
      : importedSet2 ? subchapter.title : `${subchapter.id} ${subchapter.title}`;
    pageSeparator.hidden = !hasPages;
    pageLabel.hidden = !hasPages;
    pageLabel.textContent = hasPages ? `Pag. ${question.pages.join(", ")}` : "";
    questionType.textContent = question.type;
    questionType.classList.toggle("multiple", question.type === "CM");
    questionNumber.textContent = `Întrebarea ${originalIndex} din ${stats.total}${session.presented[question.id] > 1 ? " · reluată din coadă" : ""}`;
    questionText.textContent = question.text;
    answerInstruction.textContent = question.type === "CS"
      ? "Complement simplu · Alege o singură variantă. Un răspuns corect valorează 4 puncte."
      : "Complement multiplu · Fiecare opțiune evaluată corect valorează 1 punct. Nicio variantă sau toate cele 5 valorează 0 puncte.";

    const legend = document.createElement("legend");
    legend.className = "sr-only";
    legend.textContent = "Variante de răspuns";
    answersList.replaceChildren(legend, ...question.options.map(option => createAnswerOption(question, option)));
    answersList.classList.remove("is-evaluated");
    selectionWarning.hidden = true;
    selectionWarning.textContent = "";
    answerFeedback.hidden = true;
    answerFeedback.className = "answer-feedback";
    selectedAnswerFeedback.hidden = true;
    selectedAnswerList.replaceChildren();
    correctAnswerFeedback.hidden = true;
    correctAnswerText.replaceChildren();
    deferBtn.hidden = false;
    answerBtn.hidden = false;
    answerBtn.disabled = true;
    nextBtn.hidden = true;
    awaitingNext = false;
    questionText.focus?.();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function formatDuration(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map(value => String(value).padStart(2, "0")).join(":");
  }

  async function updateTimer() {
    if (!session || session.mode !== "exam" || session.status !== "active") return;
    const secondsLeft = Math.max(0, Math.ceil((session.endsAt - Date.now()) / 1000));
    timer.textContent = formatDuration(secondsLeft);
    timerPanel.classList.toggle("urgent", secondsLeft <= 10 * 60);

    if (secondsLeft === 0 && !actionPending) {
      actionPending = true;
      clearInterval(timerInterval);
      try {
        await app.completeSession(session, "time-expired");
        renderResult();
        showToast("Timpul a expirat. Simularea a fost finalizată automat.");
      } catch (error) {
        showError(error.message);
      } finally {
        actionPending = false;
      }
    }
  }

  function startTimer() {
    clearInterval(timerInterval);
    timerPanel.hidden = session.mode !== "exam";
    if (session.mode !== "exam" || session.status !== "active") return;
    void updateTimer();
    timerInterval = setInterval(() => void updateTimer(), 1000);
  }

  function createAnswerRows(question, optionIds, emptyLabel) {
    const fragment = document.createDocumentFragment();
    if (!optionIds.length) {
      const empty = document.createElement("div");
      empty.className = "answer-result-row is-empty";
      empty.textContent = emptyLabel;
      fragment.append(empty);
      return fragment;
    }

    optionIds.forEach(optionId => {
      const option = question.options.find(item => item.id === optionId);
      const row = document.createElement("div");
      row.className = `answer-result-row ${question.correct.includes(optionId) ? "is-correct" : "is-wrong"}`;
      const letter = document.createElement("strong");
      letter.textContent = `${optionId}.`;
      const text = document.createElement("span");
      text.textContent = option?.text || "";
      const status = document.createElement("em");
      status.className = "answer-row-status";
      status.textContent = question.correct.includes(optionId) ? "✓ Corect" : "× Greșit";
      row.append(letter, text, status);
      fragment.append(row);
    });
    return fragment;
  }

  function renderAnswerFeedback(question, selection, scoredAnswer) {
    renderSessionProgress();
    awaitingNext = true;

    answersList.classList.add("is-evaluated");
    answersList.querySelectorAll('input[name="answer"]').forEach(input => {
      input.disabled = true;
      const option = input.closest(".answer-option");
      const isCorrect = question.correct.includes(input.value);
      const isSelected = input.checked;
      const status = option.querySelector(".option-result");
      option.classList.toggle("correct-option", isCorrect);
      option.classList.toggle("selected-correct-option", isSelected && isCorrect);
      option.classList.toggle("missed-correct-option", !isSelected && isCorrect);
      option.classList.toggle("wrong-option", isSelected && !isCorrect);
      option.classList.toggle("neutral-option", !isSelected && !isCorrect);
      status.textContent = isSelected && isCorrect
        ? "Selectat corect"
        : isSelected ? "Selectat greșit" : isCorrect ? "Răspuns corect" : "";
      status.hidden = !status.textContent;
    });

    answerFeedback.hidden = false;
    answerFeedback.className = `answer-feedback ${scoredAnswer.fullyCorrect ? "is-correct" : "is-wrong"}`;
    feedbackIcon.textContent = scoredAnswer.fullyCorrect ? "✓" : "!";
    feedbackTitle.textContent = scoredAnswer.fullyCorrect ? "Corect!" : "Răspuns greșit";
    feedbackPoints.textContent = `Ai obținut ${scoredAnswer.score} / ${scoredAnswer.maxScore} puncte la această grilă.`;
    selectedAnswerList.replaceChildren(createAnswerRows(question, selection, "Niciun răspuns"));
    selectedAnswerFeedback.hidden = false;
    correctAnswerFeedback.hidden = scoredAnswer.fullyCorrect;
    correctAnswerText.replaceChildren(createAnswerRows(question, question.correct, "—"));
    selectionWarning.hidden = true;
    deferBtn.hidden = true;
    answerBtn.hidden = true;
    nextBtnLabel.textContent = session.status === "completed" ? "Vezi rezultatul" : "Următoarea întrebare";
    nextBtn.hidden = false;
    nextBtn.focus();
    answerFeedback.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }

  function createReviewItem(detail, index) {
    const question = app.questionById.get(detail.questionId);
    const chapter = app.chapterById.get(question.chapterId);
    const subchapter = app.subchapterById.get(question.subchapterId);
    const article = document.createElement("article");
    article.className = `review-item${detail.answered ? "" : " unanswered"}`;

    const meta = document.createElement("div");
    meta.className = "review-item-meta";
    const context = document.createElement("span");
    context.textContent = `${chapter.code} · ${subchapter.id} ${subchapter.title}`;
    const score = document.createElement("strong");
    score.textContent = detail.answered ? `${detail.score} / ${detail.maxScore} puncte` : "Fără răspuns";
    meta.append(context, score);

    const title = document.createElement("h3");
    title.textContent = `${index + 1}. ${question.text}`;

    const comparison = document.createElement("div");
    comparison.className = "answer-comparison";
    const userAnswer = document.createElement("div");
    const userLabel = document.createElement("span");
    userLabel.textContent = "Răspunsul tău";
    const userText = document.createElement("div");
    userText.className = "review-answer-list";
    userText.append(createAnswerRows(question, detail.selection, "Niciun răspuns"));
    userAnswer.append(userLabel, userText);

    const correctAnswer = document.createElement("div");
    correctAnswer.className = "correct-answer";
    const correctLabel = document.createElement("span");
    correctLabel.textContent = "Răspuns corect";
    const correctText = document.createElement("div");
    correctText.className = "review-answer-list";
    correctText.append(createAnswerRows(question, question.correct, "—"));
    correctAnswer.append(correctLabel, correctText);

    comparison.append(userAnswer, correctAnswer);
    article.append(meta, title, comparison);
    return article;
  }

  function renderResult() {
    clearInterval(timerInterval);
    awaitingNext = false;
    const result = session.result || app.calculateResult(session);
    const resultDetails = result.details.filter(detail => !detail.fullyCorrect);
    const resultEyebrow = document.getElementById("resultEyebrow");
    const resultSubtitle = document.getElementById("resultSubtitle");
    const resultPercentage = document.getElementById("resultPercentage");
    const correctResult = document.getElementById("correctResult");
    const pointsResult = document.getElementById("pointsResult");
    const unansweredResult = document.getElementById("unansweredResult");
    const reviewCount = document.getElementById("reviewCount");
    const reviewList = document.getElementById("reviewList");
    const perfectResult = document.getElementById("perfectResult");

    showOnly(resultView);
    resultEyebrow.textContent = session.mode === "exam"
      ? "Simulare finalizată"
      : session.mode === "mistakes" ? "Recapitulare finalizată" : "Test finalizat";
    resultSubtitle.textContent = `Ai răspuns la ${result.answeredCount} din ${result.totalQuestions} întrebări și ai obținut ${result.score} puncte.`;
    resultPercentage.textContent = `${result.percentage.toLocaleString("ro-RO")}%`;
    correctResult.textContent = `${result.correctCount} / ${result.totalQuestions}`;
    pointsResult.textContent = `${result.score} / ${result.maxScore}`;
    unansweredResult.textContent = String(result.unansweredCount);
    reviewCount.textContent = `${resultDetails.length} ${resultDetails.length === 1 ? "întrebare" : "întrebări"}`;
    reviewList.replaceChildren(...resultDetails.map(createReviewItem));
    perfectResult.hidden = resultDetails.length !== 0;
    reviewList.hidden = resultDetails.length === 0;
    resultFileStatus.textContent = session.resultDownloadTriggeredAt
      ? "Raportul a mai fost descărcat și poate fi descărcat din nou oricând."
      : "Rezultatul este salvat în profil. Descarcă raportul complet pentru a-l păstra și ca fișier.";
    window.scrollTo({ top: 0, behavior: "smooth" });

  }

  answerForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (actionPending || awaitingNext) return;
    actionPending = true;
    deferBtn.disabled = true;
    answerBtn.disabled = true;
    const question = session?.currentQuestionId ? app.questionById.get(session.currentQuestionId) : null;
    const selection = selectedOptions();
    try {
      const scoredAnswer = await app.submitCurrentAnswer(session, selection);
      renderAnswerFeedback(question, selection, scoredAnswer);
    } catch (error) {
      showToast(error.message);
      if (question) updateAnswerState(question);
    } finally {
      actionPending = false;
      deferBtn.disabled = false;
    }
  });

  nextBtn.addEventListener("click", () => {
    if (actionPending || !awaitingNext) return;
    if (session.status === "completed") renderResult();
    else renderActiveQuestion();
  });

  answersList.addEventListener("change", () => {
    if (awaitingNext) return;
    const question = session?.currentQuestionId ? app.questionById.get(session.currentQuestionId) : null;
    if (question) updateAnswerState(question);
  });

  deferBtn.addEventListener("click", async () => {
    if (actionPending || awaitingNext) return;
    actionPending = true;
    deferBtn.disabled = true;
    answerBtn.disabled = true;
    try {
      await app.deferCurrentQuestion(session);
      showToast("Întrebarea a fost mutată la finalul cozii.");
      renderActiveQuestion();
    } catch (error) {
      showToast(error.message);
    } finally {
      actionPending = false;
      deferBtn.disabled = false;
    }
  });

  finishBtn.addEventListener("click", async () => {
    if (actionPending) return;
    const stats = app.sessionStats(session);
    const message = `Mai ai ${stats.unanswered} ${stats.unanswered === 1 ? "întrebare" : "întrebări"} fără răspuns. Acestea vor primi 0 puncte. Finalizezi testul?`;
    if (!window.confirm(message)) return;
    actionPending = true;
    finishBtn.disabled = true;
    try {
      await app.completeSession(session, "manual-with-unanswered");
      renderResult();
    } catch (error) {
      showToast(error.message);
      finishBtn.disabled = false;
    } finally {
      actionPending = false;
    }
  });

  downloadResultBtn.addEventListener("click", () => {
    downloadResultReport();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void updateTimer();
  });

  try {
    await app.ready;
    session = app.getSession();
  } catch (error) {
    showError(`${error.message} Pornește aplicația folosind porneste-grile.bat.`);
    return;
  }

  if (!session) {
    showError("Nu există un test generat. Întoarce-te la pagina de selectare și pornește unul nou.");
    return;
  }

  if (session.status === "completed") {
    renderResult();
    return;
  }

  if (session.mode === "exam" && session.endsAt <= Date.now()) {
    try {
      await app.completeSession(session, "time-expired");
      renderResult();
    } catch (error) {
      showError(error.message);
    }
    return;
  }

  renderActiveQuestion();
  startTimer();
});
