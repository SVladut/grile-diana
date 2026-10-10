(function initFlashcardsPage(global) {
  "use strict";

  const app = global.GrileApp;
  const elements = {};
  const selectedDeckIds = new Set();
  const allowedHtmlTags = new Set([
    "B", "BR", "EM", "H3", "HR", "I", "LI", "OL", "P", "SPAN", "STRONG", "SUB", "SUP", "U", "UL"
  ]);
  const dangerousHtmlTags = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "IMG", "SVG", "MATH"]);
  let session = null;
  let answerRevealed = false;
  let toastTimer = null;
  let ratingPending = false;
  let libraryRatings = {};

  function byId(id) {
    return document.getElementById(id);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("ro-RO").format(Number(value) || 0);
  }

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function highlightClassFromStyle(style) {
    const normalized = String(style || "").toLowerCase().replace(/\s+/g, "");
    if (!normalized.includes("background")) return "";
    if (normalized.includes("yellow") || normalized.includes("#ffff00") || normalized.includes("rgb(255,255,0)")) return "highlight-yellow";
    if (normalized.includes("green") || normalized.includes("#00ff00") || normalized.includes("rgb(0,255,0)")) return "highlight-green";
    if (normalized.includes("blue") || normalized.includes("#00ffff") || normalized.includes("rgb(0,255,255)")) return "highlight-blue";
    if (normalized.includes("red") || normalized.includes("#ff0000") || normalized.includes("rgb(255,0,0)")) return "highlight-red";
    return "";
  }

  function sanitizedHtmlFragment(markup) {
    const template = document.createElement("template");
    template.innerHTML = String(markup || "");
    const nodes = [...template.content.querySelectorAll("*")];

    nodes.forEach(node => {
      if (dangerousHtmlTags.has(node.tagName)) {
        node.remove();
        return;
      }
      if (!allowedHtmlTags.has(node.tagName)) {
        node.replaceWith(...node.childNodes);
        return;
      }
      const highlightClass = node.tagName === "SPAN" ? highlightClassFromStyle(node.getAttribute("style")) : "";
      [...node.attributes].forEach(attribute => node.removeAttribute(attribute.name));
      if (highlightClass) node.classList.add(highlightClass);
    });

    return template.content;
  }

  function renderRichText(target, markup) {
    target.replaceChildren(sanitizedHtmlFragment(markup));
  }

  function showToast(message) {
    if (toastTimer) global.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    toastTimer = global.setTimeout(() => {
      elements.toast.hidden = true;
    }, 3000);
  }

  function showOnly(view) {
    elements.libraryView.hidden = view !== "library";
    elements.studyView.hidden = view !== "study";
    elements.resultView.hidden = view !== "result";
    elements.errorView.hidden = view !== "error";
    global.scrollTo({ top: 0, behavior: "smooth" });
  }

  function selectedDecks() {
    return app.flashcardBank.decks.filter(deck => selectedDeckIds.has(deck.id));
  }

  function metricsForDeckIds(deckIds) {
    const ids = Array.isArray(deckIds)
      ? deckIds
      : app.flashcardBank.decks.map(deck => deck.id);
    const cardIds = ids.flatMap(deckId => app.flashcardDeckById.get(deckId)?.cardIds || []);
    const now = Date.now();
    let studied = 0;
    let mastered = 0;
    let due = 0;
    let reviews = 0;
    let confidenceTotal = 0;

    cardIds.forEach(cardId => {
      const record = libraryRatings[cardId];
      if (!record) return;
      studied += 1;
      mastered += record.confidence === 5 ? 1 : 0;
      due += !Number.isFinite(record.nextDueAt) || record.nextDueAt <= now ? 1 : 0;
      reviews += Number.isInteger(record.reviews) ? record.reviews : 0;
      confidenceTotal += Number(record.confidence) || 0;
    });
    return {
      total: cardIds.length,
      studied,
      mastered,
      due,
      reviews,
      averageConfidence: studied ? Math.round(confidenceTotal / studied * 10) / 10 : 0
    };
  }

  function selectionCardCount() {
    return selectedDecks().reduce((sum, deck) => sum + deck.cardIds.length, 0);
  }

  function updateChapterCheckboxes() {
    document.querySelectorAll("[data-chapter-checkbox]").forEach(checkbox => {
      const chapter = app.flashcardBank.chapters.find(item => item.id === checkbox.dataset.chapterCheckbox);
      const selectedCount = chapter.deckIds.filter(deckId => selectedDeckIds.has(deckId)).length;
      checkbox.checked = selectedCount === chapter.deckIds.length;
      checkbox.indeterminate = selectedCount > 0 && selectedCount < chapter.deckIds.length;
    });
  }

  function updateSelectionSummary() {
    const selectedCount = selectedDeckIds.size;
    const cardCount = selectionCardCount();
    const allSelected = selectedCount === app.flashcardBank.decks.length;
    elements.selectAllDecks.textContent = allSelected ? "Deselectează tot" : "Selectează tot";
    elements.selectedDeckSummary.textContent = selectedCount
      ? `${formatNumber(selectedCount)} ${selectedCount === 1 ? "set selectat" : "seturi selectate"}`
      : "Niciun set selectat";
    elements.selectedCardSummary.textContent = selectedCount
      ? `${formatNumber(cardCount)} flashcarduri disponibile în selecție.`
      : "Alege cel puțin un set pentru a începe.";
    elements.studyCount.max = String(Math.max(1, cardCount));
    const currentCount = Number(elements.studyCount.value);
    if (!selectedCount) elements.studyCount.value = "";
    else if (!Number.isInteger(currentCount) || currentCount < 1 || currentCount > cardCount) {
      elements.studyCount.value = String(Math.min(20, cardCount));
    }
    elements.studyCount.disabled = !selectedCount;
    elements.startStudy.disabled = !selectedCount;
    elements.setupMessage.hidden = true;
    updateChapterCheckboxes();
  }

  function createDeckOption(deck) {
    const metrics = metricsForDeckIds([deck.id]);
    const label = createElement("label", "deck-option");
    const checkbox = createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.deckId = deck.id;
    checkbox.checked = selectedDeckIds.has(deck.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedDeckIds.add(deck.id);
      else selectedDeckIds.delete(deck.id);
      updateSelectionSummary();
    });

    const copy = createElement("span", "deck-copy");
    copy.append(
      createElement("strong", "", deck.name),
      createElement("small", "", `${formatNumber(deck.cardIds.length)} carduri · ${formatNumber(metrics.studied)} parcurse`)
    );
    const confidence = createElement("span", "confidence-mini", metrics.studied ? metrics.averageConfidence.toFixed(1) : "—");
    confidence.title = metrics.studied ? "Încrederea medie" : "Set încă neparcurs";
    label.append(checkbox, copy, confidence);
    return label;
  }

  function createChapterGroup(chapter) {
    const metrics = metricsForDeckIds(chapter.deckIds);
    const group = createElement("article", "chapter-group");
    group.dataset.chapterId = chapter.id;
    const header = createElement("div", "chapter-header");
    const label = createElement("label", "chapter-selector");
    const checkbox = createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.chapterCheckbox = chapter.id;
    checkbox.addEventListener("change", () => {
      chapter.deckIds.forEach(deckId => {
        if (checkbox.checked) selectedDeckIds.add(deckId);
        else selectedDeckIds.delete(deckId);
      });
      chapter.deckIds.forEach(deckId => {
        const deckCheckbox = document.querySelector(`[data-deck-id="${CSS.escape(deckId)}"]`);
        if (deckCheckbox) deckCheckbox.checked = checkbox.checked;
      });
      updateSelectionSummary();
    });
    label.append(checkbox, createElement("strong", "", `${chapter.code}. ${chapter.title}`));

    const chapterMetrics = createElement("div", "chapter-metrics");
    const totalMetric = createElement("span", "metric-pill");
    totalMetric.append(createElement("strong", "", formatNumber(metrics.total)), document.createTextNode(" carduri"));
    const progressMetric = createElement("span", "metric-pill");
    progressMetric.append(createElement("strong", "", formatNumber(metrics.studied)), document.createTextNode(" parcurse"));
    const dueMetric = createElement("span", "metric-pill");
    dueMetric.append(createElement("strong", "", formatNumber(metrics.due)), document.createTextNode(" de repetat"));
    chapterMetrics.append(totalMetric, progressMetric, dueMetric);
    header.append(label, chapterMetrics);

    const deckList = createElement("div", "deck-list");
    chapter.deckIds
      .map(deckId => app.flashcardDeckById.get(deckId))
      .filter(Boolean)
      .forEach(deck => deckList.append(createDeckOption(deck)));
    group.append(header, deckList);
    return group;
  }

  function updateOverallMetrics() {
    const metrics = metricsForDeckIds();
    elements.totalCards.textContent = formatNumber(metrics.total);
    elements.studiedCards.textContent = formatNumber(metrics.studied);
    elements.averageConfidence.textContent = metrics.averageConfidence.toFixed(1);
    elements.libraryCardCount.textContent = formatNumber(metrics.total);
  }

  function updateResumeBanner() {
    const savedSession = app.getFlashcardSession();
    const canResume = savedSession?.status === "active";
    elements.resumeFlashcards.hidden = !canResume;
    if (canResume) {
      const remaining = Math.max(0, savedSession.targetReviews - savedSession.reviewedCount);
      elements.resumeFlashcardText.textContent = `${formatNumber(savedSession.reviewedCount)} din ${formatNumber(savedSession.targetReviews)} evaluări făcute · ${formatNumber(remaining)} rămase.`;
    }
  }

  function renderLibrary() {
    libraryRatings = app.getFlashcardState().ratings;
    updateOverallMetrics();
    elements.chapterList.replaceChildren(...app.flashcardBank.chapters.map(createChapterGroup));
    updateSelectionSummary();
    updateResumeBanner();
  }

  function sessionAverage(activeSession) {
    if (!activeSession?.reviewedCount) return 0;
    const total = Object.entries(activeSession.ratingCounts || {})
      .reduce((sum, [rating, count]) => sum + Number(rating) * Number(count || 0), 0);
    return Math.round((total / activeSession.reviewedCount) * 10) / 10;
  }

  function renderSessionStats() {
    const reviewed = session.reviewedCount || 0;
    const target = session.targetReviews || 0;
    const progress = target ? Math.min(100, reviewed / target * 100) : 0;
    elements.studyProgressLabel.textContent = `${formatNumber(reviewed)} din ${formatNumber(target)} evaluări`;
    elements.studyProgressBar.style.width = `${progress}%`;
    elements.sessionAverage.textContent = sessionAverage(session).toFixed(1);
    elements.sessionReviewed.textContent = formatNumber(reviewed);
    elements.sessionUnique.textContent = formatNumber(Object.keys(session.uniqueSeen || {}).length);
    elements.sessionGain.textContent = `+${formatNumber(session.confidenceGain || 0)}`;
  }

  function revealCurrentAnswer() {
    if (!session || session.status !== "active" || answerRevealed) return;
    answerRevealed = true;
    elements.cardBackPanel.hidden = false;
    elements.confidencePanel.hidden = false;
    elements.revealAnswer.hidden = true;
    elements.flashcard.classList.add("answer-revealed");
    elements.confidencePanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderCurrentCard() {
    const card = app.flashcardById.get(session?.currentCardId);
    if (!card) {
      showError("Cardul curent nu există în banca instalată.");
      return;
    }
    const deck = app.flashcardDeckById.get(card.deckId);
    const chapter = app.flashcardBank.chapters.find(item => item.id === card.chapterId);
    answerRevealed = false;
    ratingPending = false;
    elements.flashcard.classList.remove("answer-revealed");
    elements.revealAnswer.hidden = false;
    elements.cardBackPanel.hidden = true;
    elements.confidencePanel.hidden = true;
    elements.cardChapter.textContent = chapter ? `${chapter.code}. ${chapter.title}` : "Capitol";
    elements.cardDeck.textContent = deck?.name || "Set";
    elements.cardPages.textContent = card.pages.length
      ? `${card.pages.length === 1 ? "pagina" : "paginile"} ${card.pages.join(", ")}`
      : "";
    elements.cardPages.hidden = !card.pages.length;
    renderRichText(elements.cardFront, card.frontHtml);
    renderRichText(elements.cardBack, card.backHtml);
    document.querySelectorAll("[data-confidence]").forEach(button => { button.disabled = false; });
    renderSessionStats();
  }

  function showStudy(activeSession) {
    session = activeSession;
    if (!session || session.status !== "active") {
      showError("Sesiunea de flashcarduri nu mai este disponibilă.");
      return;
    }
    selectedDeckIds.clear();
    session.deckIds.forEach(deckId => selectedDeckIds.add(deckId));
    showOnly("study");
    renderCurrentCard();
  }

  function showResult(completedSession) {
    session = completedSession;
    const result = completedSession?.result;
    if (!result) {
      showError("Rezultatul sesiunii nu este disponibil.");
      return;
    }
    elements.resultReviewed.textContent = formatNumber(result.reviewedCount);
    elements.resultUnique.textContent = formatNumber(result.uniqueCount);
    elements.resultAverage.textContent = `${Number(result.averageConfidence || 0).toFixed(1)} / 5`;
    elements.resultGain.textContent = `+${formatNumber(result.confidenceGain || 0)}`;
    const difficult = Number(result.ratingCounts?.["1"] || 0) + Number(result.ratingCounts?.["2"] || 0);
    elements.resultSummary.textContent = difficult
      ? `${formatNumber(difficult)} răspunsuri au primit nota 1 sau 2 și vor reveni mai repede la repetare.`
      : "Ai evaluat toate cardurile cu cel puțin 3. Continuă pentru a fixa informația pe termen lung.";
    showOnly("result");
  }

  function showError(message) {
    elements.errorMessage.textContent = message;
    showOnly("error");
  }

  async function startNewSession(event) {
    event?.preventDefault();
    const count = Number(elements.studyCount.value);
    elements.setupMessage.hidden = true;
    elements.startStudy.disabled = true;
    try {
      const newSession = app.createFlashcardSession([...selectedDeckIds], count);
      await app.saveFlashcardSession(newSession);
      showStudy(newSession);
    } catch (error) {
      elements.setupMessage.textContent = error.message || "Sesiunea nu a putut fi pornită.";
      elements.setupMessage.hidden = false;
      elements.startStudy.disabled = selectedDeckIds.size === 0;
    }
  }

  async function rateCurrentCard(confidence) {
    if (!answerRevealed || ratingPending) return;
    ratingPending = true;
    document.querySelectorAll("[data-confidence]").forEach(button => { button.disabled = true; });
    try {
      const outcome = await app.rateFlashcard(session, confidence);
      if (outcome.completed) showResult(session);
      else renderCurrentCard();
    } catch (error) {
      ratingPending = false;
      document.querySelectorAll("[data-confidence]").forEach(button => { button.disabled = false; });
      showToast(error.message || "Nota nu a putut fi salvată.");
    }
  }

  async function discardSession() {
    if (!global.confirm("Renunți la sesiunea în desfășurare? Progresul deja evaluat rămâne salvat.")) return;
    await app.clearFlashcardSession();
    session = null;
    renderLibrary();
    showToast("Sesiunea a fost închisă. Evaluările făcute au rămas salvate.");
  }

  async function repeatRound() {
    const previous = session;
    if (!previous?.deckIds?.length) return;
    try {
      const next = app.createFlashcardSession(previous.deckIds, previous.targetReviews);
      await app.saveFlashcardSession(next);
      showStudy(next);
    } catch (error) {
      showToast(error.message || "Runda nouă nu a putut fi pornită.");
    }
  }

  function bindEvents() {
    elements.studySetup.addEventListener("submit", startNewSession);
    elements.selectAllDecks.addEventListener("click", () => {
      const selectAll = selectedDeckIds.size !== app.flashcardBank.decks.length;
      selectedDeckIds.clear();
      if (selectAll) app.flashcardBank.decks.forEach(deck => selectedDeckIds.add(deck.id));
      document.querySelectorAll("[data-deck-id]").forEach(checkbox => { checkbox.checked = selectAll; });
      updateSelectionSummary();
    });
    elements.revealAnswer.addEventListener("click", revealCurrentAnswer);
    document.querySelectorAll("[data-confidence]").forEach(button => {
      button.addEventListener("click", () => rateCurrentCard(Number(button.dataset.confidence)));
    });
    elements.exitStudy.addEventListener("click", () => {
      renderLibrary();
      showOnly("library");
    });
    elements.resumeFlashcardSession.addEventListener("click", () => showStudy(app.getFlashcardSession()));
    elements.discardFlashcardSession.addEventListener("click", () => discardSession().catch(error => showToast(error.message)));
    elements.repeatRound.addEventListener("click", () => repeatRound());
    elements.backToLibrary.addEventListener("click", async () => {
      await app.clearFlashcardSession();
      session = null;
      renderLibrary();
      showOnly("library");
    });
    elements.resetFlashcardProgress.addEventListener("click", async () => {
      if (!global.confirm("Resetezi toate notele și sesiunile de flashcarduri? Această acțiune nu poate fi anulată.")) return;
      await app.resetFlashcardProgress();
      session = null;
      renderLibrary();
      showToast("Progresul flashcardurilor a fost resetat.");
    });
    document.addEventListener("keydown", event => {
      if (elements.studyView.hidden || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)) return;
      if ((event.code === "Space" || event.key === " ") && !answerRevealed) {
        event.preventDefault();
        revealCurrentAnswer();
      } else if (answerRevealed && /^[1-5]$/.test(event.key)) {
        event.preventDefault();
        rateCurrentCard(Number(event.key));
      }
    });
  }

  async function initialize() {
    [
      "libraryView", "studyView", "resultView", "errorView", "totalCards", "studiedCards", "averageConfidence",
      "libraryCardCount", "resumeFlashcards", "resumeFlashcardText", "resumeFlashcardSession", "discardFlashcardSession",
      "chapterList", "selectAllDecks", "studySetup", "selectedDeckSummary", "selectedCardSummary", "studyCount",
      "startStudy", "setupMessage", "resetFlashcardProgress", "studyProgressLabel", "studyProgressBar", "exitStudy",
      "flashcard", "cardChapter", "cardDeck", "cardPages", "cardFront", "revealAnswer", "cardBackPanel", "cardBack",
      "confidencePanel", "sessionAverage", "sessionReviewed", "sessionUnique", "sessionGain", "resultSummary",
      "resultReviewed", "resultUnique", "resultAverage", "resultGain", "repeatRound", "backToLibrary", "errorMessage", "toast"
    ].forEach(id => { elements[id] = byId(id); });

    try {
      if (!app?.ready) throw new Error("Motorul aplicației nu este disponibil.");
      await app.ready;
      if (!app.flashcardBank?.cards?.length) throw new Error("Banca de flashcarduri este goală.");
      bindEvents();
      renderLibrary();
      const savedSession = app.getFlashcardSession();
      if (savedSession?.status === "completed" && savedSession.result) showResult(savedSession);
      else showOnly("library");
    } catch (error) {
      showError(error.message || "A apărut o eroare la încărcare.");
    }
  }

  document.addEventListener("DOMContentLoaded", initialize);
})(typeof window !== "undefined" ? window : globalThis);
