(function initMaterialsPage(global) {
  "use strict";

  const app = global.GrileApp;
  const elements = {};
  const viewedThisVisit = new Set();
  const sectionSearchCache = new Map();
  const allowedHtmlTags = new Set([
    "B", "BR", "EM", "I", "LI", "OL", "P", "SPAN", "STRONG", "SUB", "SUP", "U", "UL"
  ]);
  const dangerousHtmlTags = new Set([
    "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "IMG", "SVG", "MATH"
  ]);

  let selectedSubchapter = null;
  let session = null;
  let answerChecked = false;
  let lastResult = null;
  let toastTimer = null;
  let actionPending = false;
  let notesStateCache = { version: 1, updatedAt: null, testRuns: 0, sections: {}, subchapters: {} };
  let activeBlank = null;
  const lastTestSignatures = new Map();

  function byId(id) {
    return document.getElementById(id);
  }

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("ro-RO").format(Number(value) || 0);
  }

  function formatPercentage(value) {
    const number = Number(value) || 0;
    return `${new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 1 }).format(number)}%`;
  }

  function normalizeSearch(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("ro-RO")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeAnswer(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("ro-RO")
      .replace(/[\u2013\u2014\u2212]/g, "-")
      .replace(/≥/g, ">=")
      .replace(/≤/g, "<=")
      .replace(/×/g, "x")
      .replace(/(\d),(?=\d)/g, "$1.")
      .replace(/[^\p{L}\p{N}%+./<>=°µμ-]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function plainTextFromHtml(markup) {
    const template = document.createElement("template");
    template.innerHTML = String(markup || "");
    dangerousHtmlTags.forEach(tag => {
      template.content.querySelectorAll(tag.toLowerCase()).forEach(node => node.remove());
    });
    return String(template.content.textContent || "").replace(/\s+/g, " ").trim();
  }

  function highlightClassFromStyle(style) {
    const normalized = String(style || "").toLowerCase().replace(/\s+/g, "");
    const color = normalized.match(/(?:^|;)color:([^;]+)/)?.[1] || "";
    if (color.includes("orange") || color.includes("#ffa500") || color.includes("rgb(255,165,0)")) return "highlight-orange";
    if (color.includes("yellow") || color.includes("#ffff00") || color.includes("rgb(255,255,0)")) return "highlight-yellow";
    if (color.includes("green") || color.includes("#00ff00") || color.includes("rgb(0,255,0)")) return "highlight-green";
    if (color.includes("blue") || color.includes("cyan") || color.includes("#00ffff") || color.includes("rgb(0,255,255)")) return "highlight-blue";
    if (color.includes("red") || color.includes("#ff0000") || color.includes("rgb(255,0,0)")) return "highlight-red";
    if (color.includes("pink")) return "highlight-pink";
    if (color.includes("purple") || color.includes("violet")) return "highlight-purple";
    return "";
  }

  function sanitizedHtmlFragment(markup) {
    const template = document.createElement("template");
    template.innerHTML = String(markup || "");

    [...template.content.querySelectorAll("*")].forEach(node => {
      if (dangerousHtmlTags.has(node.tagName)) {
        node.remove();
        return;
      }
      if (!allowedHtmlTags.has(node.tagName)) {
        node.replaceWith(...node.childNodes);
        return;
      }
      const highlightClass = node.tagName === "SPAN"
        ? highlightClassFromStyle(node.getAttribute("style"))
        : "";
      [...node.attributes].forEach(attribute => node.removeAttribute(attribute.name));
      if (highlightClass) node.classList.add(highlightClass);
    });

    return template.content;
  }

  function showToast(message) {
    if (toastTimer) global.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    toastTimer = global.setTimeout(() => {
      elements.toast.hidden = true;
    }, 3200);
  }

  function setQuerySubchapter(subchapterId) {
    try {
      const url = new URL(global.location.href);
      if (subchapterId) url.searchParams.set("subchapter", subchapterId);
      else url.searchParams.delete("subchapter");
      global.history.replaceState(null, "", url);
    } catch (_error) {
      // Navigarea funcționează și dacă browserul nu permite rescrierea URL-ului local.
    }
  }

  function showOnly(view) {
    elements.libraryView.hidden = view !== "library";
    elements.readerView.hidden = view !== "reader";
    elements.testView.hidden = view !== "test";
    elements.resultView.hidden = view !== "result";
    elements.errorView.hidden = view !== "error";
    global.scrollTo({ top: 0, behavior: "smooth" });
  }

  function currentNotesState() {
    return notesStateCache;
  }

  function refreshNotesState() {
    notesStateCache = app.getNotesState?.() || { version: 1, updatedAt: null, testRuns: 0, sections: {}, subchapters: {} };
    return notesStateCache;
  }

  function notesMetrics(sectionIds) {
    return app.notesMetrics(sectionIds, notesStateCache);
  }

  function sectionRecord(sectionId) {
    return currentNotesState().sections?.[sectionId] || null;
  }

  function isSectionComplete(sectionId) {
    return Number.isFinite(sectionRecord(sectionId)?.completedAt);
  }

  function updateOverallProgress() {
    const metadata = app.notesBank.metadata || {};
    const metrics = notesMetrics();
    elements.heroChapterCount.textContent = formatNumber(metadata.chapterCount || app.notesBank.chapters.length);
    elements.heroSubchapterCount.textContent = formatNumber(metadata.subchapterCount || app.notesBank.subchapters.length);
    elements.heroSectionCount.textContent = formatNumber(metadata.sectionCount || app.notesBank.sections.length);
    elements.heroClozeCount.textContent = formatNumber(metadata.recallLineCount || metadata.clozeCount || 0);
    elements.overallCoverage.textContent = formatPercentage(metrics.coverage);
    elements.overallCompleted.textContent = `${formatNumber(metrics.completed)} din ${formatNumber(metrics.total)} secțiuni`;
    elements.overallAccuracy.textContent = metrics.totalAnswers
      ? `Acuratețe completări: ${formatPercentage(metrics.accuracy)}`
      : "Acuratețe completări: —";
    elements.overallProgressBar.style.width = `${Math.min(100, Math.max(0, metrics.coverage))}%`;
  }

  function chapterForSubchapter(subchapter) {
    return app.notesBank.chapters.find(chapter => chapter.id === subchapter?.chapterId) || null;
  }

  function sectionsForSubchapter(subchapter) {
    return (subchapter?.sectionIds || [])
      .map(sectionId => app.noteSectionById.get(sectionId))
      .filter(Boolean);
  }

  function createMetricPill(value, label) {
    const pill = createElement("span", "metric-pill");
    pill.append(createElement("strong", "", value), createElement("small", "", label));
    return pill;
  }

  function createSubchapterCard(subchapter) {
    const metrics = notesMetrics(subchapter.sectionIds);
    const card = createElement("article", "subchapter-card");
    card.dataset.subchapterId = subchapter.id;

    const copy = createElement("div", "subchapter-copy");
    copy.append(createElement("span", "subchapter-code", `Subcapitolul ${subchapter.code}`));
    copy.append(createElement("h3", "", subchapter.title));
    const progress = createElement("div", "subchapter-progress");
    const progressCopy = createElement("span");
    progressCopy.append(
      createElement("span", "", `${formatNumber(metrics.completed)} / ${formatNumber(metrics.total)} secțiuni`),
      createElement("strong", "", formatPercentage(metrics.coverage))
    );
    const track = createElement("div", "progress-track");
    const fill = createElement("i");
    fill.style.width = `${metrics.coverage}%`;
    track.append(fill);
    progress.append(progressCopy, track);
    copy.append(progress);

    const actions = createElement("div", "subchapter-actions");
    const openButton = createElement("button", "open-material", "Deschide");
    openButton.type = "button";
    openButton.dataset.openSubchapter = subchapter.id;
    const testButton = createElement("button", "quick-test", "Test complet");
    testButton.type = "button";
    testButton.dataset.testSubchapter = subchapter.id;
    actions.append(openButton, testButton);
    card.append(copy, actions);
    return card;
  }

  function createChapterCard(chapter, searchTerm, forceOpen) {
    const subchapters = chapter.subchapterIds
      .map(id => app.noteSubchapterById.get(id))
      .filter(Boolean)
      .filter(subchapter => !searchTerm || normalizeSearch(`${subchapter.code} ${subchapter.title}`).includes(searchTerm));
    if (!subchapters.length) return null;

    const sectionIds = chapter.subchapterIds.flatMap(id => app.noteSubchapterById.get(id)?.sectionIds || []);
    const metrics = notesMetrics(sectionIds);
    const card = createElement("article", `chapter-card${forceOpen ? " is-open" : ""}`);
    card.dataset.chapterId = chapter.id;
    const header = createElement("div", "chapter-header");
    const title = createElement("div", "chapter-title");
    title.append(
      createElement("small", "", `Capitolul ${chapter.code}`),
      createElement("strong", "", chapter.title)
    );
    const summary = createElement("div", "chapter-summary");
    summary.append(
      createMetricPill(formatNumber(subchapters.length), subchapters.length === 1 ? "subcapitol" : "subcapitole"),
      createMetricPill(`${formatNumber(metrics.completed)}/${formatNumber(metrics.total)}`, "secțiuni parcurse"),
      createMetricPill(metrics.totalAnswers ? formatPercentage(metrics.accuracy) : "—", "completări")
    );
    const toggle = createElement("button", "chapter-toggle", "⌄");
    toggle.type = "button";
    toggle.dataset.toggleChapter = chapter.id;
    toggle.setAttribute("aria-label", `Arată subcapitolele din capitolul ${chapter.code}`);
    toggle.setAttribute("aria-expanded", String(forceOpen));
    header.append(title, summary, toggle);

    const grid = createElement("div", "subchapter-grid");
    grid.hidden = !forceOpen;
    subchapters.forEach(subchapter => grid.append(createSubchapterCard(subchapter)));
    card.append(header, grid);
    return card;
  }

  function renderLibrary() {
    const searchTerm = normalizeSearch(elements.materialSearch.value);
    elements.chapterList.replaceChildren();
    let resultCount = 0;
    app.notesBank.chapters.forEach((chapter, index) => {
      const chapterMatches = !searchTerm || normalizeSearch(`${chapter.code} ${chapter.title}`).includes(searchTerm);
      const matchingSubchapters = chapter.subchapterIds.filter(id => {
        const subchapter = app.noteSubchapterById.get(id);
        return subchapter && (chapterMatches || normalizeSearch(`${subchapter.code} ${subchapter.title}`).includes(searchTerm));
      });
      if (!matchingSubchapters.length) return;
      resultCount += matchingSubchapters.length;
      const card = createChapterCard(chapter, chapterMatches ? "" : searchTerm, Boolean(searchTerm) || index === 0);
      if (card) elements.chapterList.append(card);
    });
    elements.libraryResultCount.textContent = searchTerm
      ? `${formatNumber(resultCount)} ${resultCount === 1 ? "subcapitol găsit" : "subcapitole găsite"}`
      : `${formatNumber(app.notesBank.subchapters.length)} subcapitole în 7 capitole`;
  }

  function updateReaderProgress() {
    if (!selectedSubchapter) return;
    const metrics = notesMetrics(selectedSubchapter.sectionIds);
    elements.readerProgress.textContent = formatPercentage(metrics.coverage);
    elements.readerProgressText.textContent = `${formatNumber(metrics.completed)} din ${formatNumber(metrics.total)} secțiuni parcurse`;
    elements.readerProgressBar.style.width = `${metrics.coverage}%`;
  }

  function pageLabel(pages) {
    if (!Array.isArray(pages) || !pages.length) return "Fără pagină";
    return `${pages.length === 1 ? "Pagina" : "Paginile"} ${pages.join(", ")}`;
  }

  function sectionSearchText(section) {
    if (!sectionSearchCache.has(section.id)) {
      sectionSearchCache.set(section.id, normalizeSearch(`${section.title} ${plainTextFromHtml(section.html)}`));
    }
    return sectionSearchCache.get(section.id);
  }

  function refreshSectionPresentation(sectionId) {
    const complete = isSectionComplete(sectionId);
    const article = elements.sectionList.querySelector(`[data-section-id="${CSS.escape(sectionId)}"]`);
    if (article) {
      article.classList.toggle("is-complete", complete);
      const status = article.querySelector(".section-status");
      if (status) status.textContent = complete ? "Parcursă" : "De parcurs";
      const completeButton = article.querySelector("[data-complete-section]");
      if (completeButton) {
        completeButton.classList.toggle("is-complete", complete);
        completeButton.textContent = complete ? "✓ Secțiune parcursă" : "Marchează ca parcursă";
      }
    }
    const navButton = elements.sectionNavigator.querySelector(`[data-go-section="${CSS.escape(sectionId)}"]`);
    if (navButton) {
      navButton.classList.toggle("is-complete", complete);
      const icon = navButton.querySelector("i");
      const articleIndex = [...elements.sectionList.querySelectorAll(".note-section")].findIndex(item => item.dataset.sectionId === sectionId);
      if (icon) icon.textContent = complete ? "✓" : String(articleIndex + 1);
    }
  }

  function renderSectionBody(article, section) {
    const body = article.querySelector(".note-section-body");
    if (!body || body.dataset.rendered === "true") return;
    body.dataset.rendered = "true";

    const content = createElement("div", "note-content");
    content.append(sanitizedHtmlFragment(section.html));
    if (!String(content.textContent || "").trim()) {
      content.replaceChildren(createElement(
        "p",
        "source-warning",
        "Această secțiune este incompletă în fișierul-sursă și nu conține încă text lizibil."
      ));
    }

    const actions = createElement("div", "section-actions");
    const completeButton = createElement(
      "button",
      `complete-section${isSectionComplete(section.id) ? " is-complete" : ""}`,
      isSectionComplete(section.id) ? "✓ Secțiune parcursă" : "Marchează ca parcursă"
    );
    completeButton.type = "button";
    completeButton.dataset.completeSection = section.id;
    const testButton = createElement("button", "primary-button", "Testează secțiunea");
    testButton.type = "button";
    testButton.dataset.testSection = section.id;
    actions.append(completeButton, testButton);
    actions.append(createElement(
      "small",
      "",
      `${formatNumber(section.recallLineCount || section.clozes.length)} ${Number(section.recallLineCount || section.clozes.length) === 1 ? "completare" : "completări"} generate dinamic`
    ));
    body.append(content, actions);
  }

  async function markViewed(section) {
    if (viewedThisVisit.has(section.id)) return;
    viewedThisVisit.add(section.id);
    try {
      await app.markNoteSectionViewed(section.id);
      refreshNotesState();
      updateOverallProgress();
    } catch (error) {
      viewedThisVisit.delete(section.id);
      console.error("Vizualizarea secțiunii nu a putut fi salvată.", error);
      showToast("Progresul de lectură nu a putut fi salvat.");
    }
  }

  function setSectionOpen(article, section, shouldOpen) {
    const body = article.querySelector(".note-section-body");
    const header = article.querySelector(".note-section-header");
    article.classList.toggle("is-open", shouldOpen);
    body.hidden = !shouldOpen;
    header.setAttribute("aria-expanded", String(shouldOpen));
    if (shouldOpen) {
      renderSectionBody(article, section);
      markViewed(section);
    }
  }

  function createSectionArticle(section, index) {
    const complete = isSectionComplete(section.id);
    const article = createElement("article", `note-section${complete ? " is-complete" : ""}`);
    article.dataset.sectionId = section.id;

    const header = createElement("button", "note-section-header");
    header.type = "button";
    header.dataset.toggleSection = section.id;
    header.setAttribute("aria-expanded", "false");
    const title = createElement("span", "section-title");
    title.append(
      createElement("strong", "", section.title),
      createElement("small", "", `${pageLabel(section.pages)} · ${formatNumber(section.recallLineCount || section.clozes.length)} completări`)
    );
    header.append(
      createElement("span", "section-index", String(index + 1)),
      title,
      createElement("span", "section-status", complete ? "Parcursă" : "De parcurs"),
      createElement("span", "section-toggle", "⌄")
    );
    const body = createElement("div", "note-section-body");
    body.hidden = true;
    article.append(header, body);
    return article;
  }

  function createSectionNavButton(section, index) {
    const button = createElement("button", isSectionComplete(section.id) ? "is-complete" : "");
    button.type = "button";
    button.dataset.goSection = section.id;
    button.append(createElement("i", "", isSectionComplete(section.id) ? "✓" : String(index + 1)));
    button.append(createElement("span", "", section.title));
    return button;
  }

  function renderReaderSections() {
    if (!selectedSubchapter) return;
    const searchTerm = normalizeSearch(elements.sectionSearch.value);
    const sections = sectionsForSubchapter(selectedSubchapter);
    const visible = sections.filter(section => !searchTerm || sectionSearchText(section).includes(searchTerm));
    elements.sectionList.replaceChildren();
    elements.sectionNavigator.replaceChildren();
    visible.forEach(section => {
      const actualIndex = sections.findIndex(item => item.id === section.id);
      elements.sectionList.append(createSectionArticle(section, actualIndex));
      elements.sectionNavigator.append(createSectionNavButton(section, actualIndex));
    });
    elements.visibleSectionCount.textContent = `${formatNumber(visible.length)} / ${formatNumber(sections.length)}`;
    elements.sectionEmpty.hidden = visible.length !== 0;
    elements.readerView.querySelector(".reader-layout").hidden = visible.length === 0;
  }

  function openSubchapter(subchapterId) {
    const subchapter = app.noteSubchapterById.get(String(subchapterId || ""));
    if (!subchapter) {
      showToast("Subcapitolul nu a fost găsit.");
      return;
    }
    selectedSubchapter = subchapter;
    const chapter = chapterForSubchapter(subchapter);
    const metrics = notesMetrics(subchapter.sectionIds);
    elements.sectionSearch.value = "";
    elements.readerChapter.textContent = `Capitolul ${chapter?.code || "—"} · ${chapter?.title || ""}`;
    elements.readerTitle.textContent = `${subchapter.code}. ${subchapter.title}`;
    elements.readerSummary.textContent = `${formatNumber(subchapter.sectionCount)} secțiuni · ${formatNumber(subchapter.recallLineCount || subchapter.clozeCount)} completări dinamice · ${metrics.totalAnswers ? `${formatPercentage(metrics.accuracy)} acuratețe` : "niciun test susținut încă"}`;
    renderReaderSections();
    updateReaderProgress();
    setQuerySubchapter(subchapter.id);
    showOnly("reader");
  }

  function toggleChapter(chapterId) {
    const card = elements.chapterList.querySelector(`[data-chapter-id="${CSS.escape(chapterId)}"]`);
    if (!card) return;
    const grid = card.querySelector(".subchapter-grid");
    const button = card.querySelector(".chapter-toggle");
    const open = !card.classList.contains("is-open");
    card.classList.toggle("is-open", open);
    grid.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  }

  function shuffled(items) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
    }
    return result;
  }

  function clozePoolsForSection(section) {
    const pools = new Map();
    section.clozes.forEach((cloze, index) => {
      const lineIndex = Number.isInteger(cloze.lineIndex) ? cloze.lineIndex : index;
      const pool = pools.get(lineIndex) || [];
      pool.push(cloze);
      pools.set(lineIndex, pool);
    });
    return [...pools.entries()].sort((left, right) => left[0] - right[0]);
  }

  function createDynamicGroup(section) {
    const clozes = clozePoolsForSection(section).map(([, pool]) => pool[Math.floor(Math.random() * pool.length)]);
    return {
      sectionId: section.id,
      sectionTitle: section.title,
      pages: section.pages,
      html: section.html,
      clozes,
      wordOrder: shuffled(clozes.map(cloze => cloze.id))
    };
  }

  function groupsSignature(groups) {
    return groups.map(group => `${group.sectionId}:${group.clozes.map(cloze => cloze.id).join(",")}:${group.wordOrder.join(",")}`).join("|");
  }

  function dynamicTestGroups(sections, signatureKey) {
    const availableSections = sections.filter(section => section.clozes.length);
    let groups = [];
    let signature = "";
    for (let attempt = 0; attempt < 8; attempt += 1) {
      groups = shuffled(availableSections).map(createDynamicGroup);
      signature = groupsSignature(groups);
      if (signature !== lastTestSignatures.get(signatureKey)) break;
    }
    if (signature === lastTestSignatures.get(signatureKey) && groups.length > 1) {
      groups.push(groups.shift());
      signature = groupsSignature(groups);
    } else if (signature === lastTestSignatures.get(signatureKey) && groups[0]?.wordOrder.length > 1) {
      groups[0].wordOrder.push(groups[0].wordOrder.shift());
      signature = groupsSignature(groups);
    }
    lastTestSignatures.set(signatureKey, signature);
    return groups;
  }

  function sectionTestGroups(section) {
    return dynamicTestGroups([section], `section:${section.id}`);
  }

  function subchapterTestGroups(subchapter) {
    return dynamicTestGroups(sectionsForSubchapter(subchapter), `subchapter:${subchapter.id}`);
  }

  function blankInput(cloze, index) {
    const input = createElement("input", "recall-blank");
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.dataset.clozeId = cloze.id;
    input.setAttribute("aria-label", `Spațiul ${index + 1}`);
    input.style.setProperty("--blank-size", String(Math.min(28, Math.max(8, cloze.answer.length + 2))));
    return input;
  }

  function replaceElementWithBlank(root, cloze, input) {
    const sourceClass = String(cloze.source || "").replace(/[^a-z]/g, "");
    const candidates = [...root.querySelectorAll("span, strong, em, i")];
    const exact = candidates.find(node => {
      if (node.closest(".highlight-orange") && sourceClass !== "orange") return false;
      const sameAnswer = normalizeAnswer(node.textContent) === String(cloze.answerKey || normalizeAnswer(cloze.answer));
      if (!sameAnswer) return false;
      if (["pink", "yellow", "green", "blue", "red", "purple", "violet"].includes(sourceClass)) {
        return node.classList.contains(`highlight-${sourceClass === "violet" ? "purple" : sourceClass}`);
      }
      return true;
    });
    if (!exact) return false;
    exact.replaceWith(input);
    return true;
  }

  function replaceTextWithBlank(root, cloze, input) {
    const walker = document.createTreeWalker(root, global.NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    const answer = String(cloze.answer || "");
    const answerKey = String(cloze.answerKey || normalizeAnswer(answer));
    const node = textNodes.find(item => {
      if (item.parentElement?.closest(".highlight-orange")) return false;
      if (item.nodeValue.includes(answer)) return true;
      return normalizeAnswer(item.nodeValue).includes(answerKey);
    });
    if (!node) return false;

    let start = node.nodeValue.indexOf(answer);
    let length = answer.length;
    if (start < 0) {
      const normalizedNode = normalizeAnswer(node.nodeValue);
      start = normalizedNode.indexOf(answerKey);
      if (start < 0) return false;
      length = Math.max(1, answer.length);
    }
    const before = node.nodeValue.slice(0, start);
    const after = node.nodeValue.slice(start + length);
    const fragment = document.createDocumentFragment();
    if (before) fragment.append(document.createTextNode(before));
    fragment.append(input);
    if (after) fragment.append(document.createTextNode(after));
    node.replaceWith(fragment);
    return true;
  }

  function recallFragment(group) {
    const root = sanitizedHtmlFragment(group.html);
    const missing = [];
    group.clozes.forEach((cloze, index) => {
      const input = blankInput(cloze, index);
      if (!replaceElementWithBlank(root, cloze, input) && !replaceTextWithBlank(root, cloze, input)) {
        missing.push({ cloze, input });
      }
    });
    missing.forEach(({ cloze, input }) => {
      const row = createElement("p", "recall-fallback-row");
      row.append(document.createTextNode(cloze.prompt?.split("_____")[0] || "Completează termenul: "));
      row.append(input);
      const after = cloze.prompt?.split("_____").slice(1).join("_____");
      if (after) row.append(document.createTextNode(after));
      root.append(row);
    });
    return root;
  }

  function startTest(groups, scope, subchapterId) {
    const subchapter = app.noteSubchapterById.get(String(subchapterId || ""));
    if (!subchapter || !Array.isArray(groups) || !groups.length) {
      showToast("Nu există completări disponibile pentru acest test.");
      return;
    }
    selectedSubchapter = subchapter;
    session = { scope, subchapterId: subchapter.id, groups: [...groups], index: 0, results: [] };
    lastResult = null;
    answerChecked = false;
    renderCurrentCloze();
    showOnly("test");
  }

  function updateVerifyAvailability() {
    const blanks = [...elements.clozePrompt.querySelectorAll(".recall-blank")];
    const complete = blanks.length > 0 && blanks.every(input => input.value.trim());
    elements.checkAnswer.disabled = answerChecked || !complete;
    elements.clozeWarning.hidden = true;
  }

  function focusBlank(input) {
    if (!input || input.disabled) return;
    elements.clozePrompt.querySelectorAll(".recall-blank").forEach(blank => blank.classList.toggle("is-active", blank === input));
    activeBlank = input;
    input.focus();
  }

  function releaseTerm(termId) {
    if (!termId) return;
    const button = elements.wordBank.querySelector(`[data-term-id="${CSS.escape(termId)}"]`);
    if (button) {
      button.classList.remove("is-used");
      button.setAttribute("aria-pressed", "false");
    }
  }

  function chooseTerm(button) {
    if (answerChecked || button.disabled) return;
    const termId = button.dataset.termId;
    const assigned = elements.clozePrompt.querySelector(`.recall-blank[data-term-id="${CSS.escape(termId)}"]`);
    if (assigned) {
      assigned.value = "";
      delete assigned.dataset.termId;
      releaseTerm(termId);
      focusBlank(assigned);
      updateVerifyAvailability();
      return;
    }

    const target = activeBlank && !activeBlank.disabled
      ? activeBlank
      : [...elements.clozePrompt.querySelectorAll(".recall-blank")].find(input => !input.value.trim());
    if (!target) {
      showToast("Toate spațiile sunt completate. Apasă Verifică sau selectează un spațiu pentru a-l schimba.");
      return;
    }
    releaseTerm(target.dataset.termId);
    target.value = button.dataset.termValue;
    target.dataset.termId = termId;
    button.classList.add("is-used");
    button.setAttribute("aria-pressed", "true");
    const nextBlank = [...elements.clozePrompt.querySelectorAll(".recall-blank")].find(input => !input.value.trim());
    if (nextBlank) focusBlank(nextBlank);
    else {
      activeBlank = target;
      elements.clozePrompt.querySelectorAll(".recall-blank").forEach(blank => blank.classList.remove("is-active"));
    }
    updateVerifyAvailability();
  }

  function renderWordBank(group) {
    const clozeById = new Map(group.clozes.map(cloze => [cloze.id, cloze]));
    elements.wordBank.replaceChildren();
    group.wordOrder.forEach((clozeId, index) => {
      const cloze = clozeById.get(clozeId);
      const button = createElement("button", "term-chip");
      button.type = "button";
      button.dataset.termId = cloze.id;
      button.dataset.termValue = cloze.answer;
      button.setAttribute("aria-pressed", "false");
      button.append(
        createElement("span", "term-shortcut", index === 9 ? "0" : String(index + 1)),
        createElement("span", "term-value", cloze.answer)
      );
      elements.wordBank.append(button);
    });
  }

  function renderCurrentCloze() {
    const group = session?.groups?.[session.index];
    if (!group) return;
    const subchapter = app.noteSubchapterById.get(session.subchapterId);
    answerChecked = false;
    activeBlank = null;
    const correctSoFar = session.results.filter(result => result.correct).length;
    elements.testProgressLabel.textContent = `Secțiunea ${formatNumber(session.index + 1)} din ${formatNumber(session.groups.length)}`;
    elements.testScoreLabel.textContent = `${formatNumber(correctSoFar)} / ${formatNumber(session.results.length)} completări corecte`;
    elements.testProgressBar.style.width = `${(session.index / session.groups.length) * 100}%`;
    elements.testSubchapter.textContent = `${subchapter.code}. ${subchapter.title}`;
    elements.testTitle.textContent = group.sectionTitle;
    elements.testPages.textContent = pageLabel(group.pages);
    elements.clozePrompt.replaceChildren(recallFragment(group));
    renderWordBank(group);
    elements.checkAnswer.disabled = true;
    elements.checkAnswer.hidden = false;
    elements.clozeWarning.hidden = true;
    elements.clozeFeedback.hidden = true;
    elements.clozeFeedback.classList.remove("is-wrong");
    elements.feedbackTitle.textContent = "";
    elements.feedbackAnswer.textContent = "";
    elements.feedbackSentence.replaceChildren();
    elements.nextCloze.hidden = true;
    const firstBlank = elements.clozePrompt.querySelector(".recall-blank");
    if (firstBlank) global.setTimeout(() => focusBlank(firstBlank), 0);
  }

  function checkCurrentAnswer(event) {
    event?.preventDefault();
    if (answerChecked || !session) return;
    const group = session.groups[session.index];
    const clozeById = new Map(group.clozes.map(cloze => [cloze.id, cloze]));
    const blanks = [...elements.clozePrompt.querySelectorAll(".recall-blank")];
    const firstEmpty = blanks.find(input => !input.value.trim());
    if (firstEmpty) {
      elements.clozeWarning.textContent = "Completează toate spațiile înainte de verificare.";
      elements.clozeWarning.hidden = false;
      focusBlank(firstEmpty);
      return;
    }

    answerChecked = true;
    const sectionResults = blanks.map(input => {
      const cloze = clozeById.get(input.dataset.clozeId);
      const rawAnswer = input.value.trim();
      const correct = normalizeAnswer(rawAnswer) === String(cloze.answerKey || normalizeAnswer(cloze.answer));
      input.disabled = true;
      input.classList.remove("is-active");
      input.classList.add(correct ? "is-correct" : "is-wrong");
      return { clozeId: cloze.id, sectionId: group.sectionId, correct, answer: rawAnswer, cloze };
    });
    session.results.push(...sectionResults);
    elements.wordBank.querySelectorAll("button").forEach(button => { button.disabled = true; });
    const correctInSection = sectionResults.filter(result => result.correct).length;
    const allCorrect = correctInSection === sectionResults.length;
    elements.checkAnswer.disabled = true;
    elements.checkAnswer.hidden = true;
    elements.clozeWarning.hidden = true;
    elements.clozeFeedback.hidden = false;
    elements.clozeFeedback.classList.toggle("is-wrong", !allCorrect);
    elements.feedbackTitle.textContent = allCorrect ? "Toate răspunsurile sunt corecte!" : `${formatNumber(correctInSection)} din ${formatNumber(sectionResults.length)} corecte`;
    elements.feedbackAnswer.textContent = allCorrect
      ? "Foarte bine — poți trece la secțiunea următoare."
      : "Răspunsurile greșite sunt marcate cu roșu. Variantele corecte sunt afișate mai jos.";
    elements.feedbackSentence.replaceChildren();
    sectionResults.forEach((result, index) => {
      const row = createElement("div", `feedback-answer-row ${result.correct ? "is-correct" : "is-wrong"}`);
      row.append(createElement("strong", "", `${result.correct ? "✓" : "✕"} Spațiul ${index + 1}`));
      row.append(createElement("span", "", result.correct
        ? result.cloze.answer
        : `Ai ales: ${result.answer} · Corect: ${result.cloze.answer}`));
      elements.feedbackSentence.append(row);
    });
    const correctTotal = session.results.filter(result => result.correct).length;
    elements.testScoreLabel.textContent = `${formatNumber(correctTotal)} / ${formatNumber(session.results.length)} completări corecte`;
    elements.testProgressBar.style.width = `${((session.index + 1) / session.groups.length) * 100}%`;
    elements.nextCloze.textContent = session.index + 1 >= session.groups.length
      ? "Vezi rezultatul →"
      : "Următoarea secțiune →";
    elements.nextCloze.hidden = false;
    elements.nextCloze.focus();
  }

  async function nextCloze() {
    if (!answerChecked || !session || actionPending) return;
    if (session.index + 1 < session.groups.length) {
      session.index += 1;
      renderCurrentCloze();
      return;
    }
    await finishTest();
  }

  async function finishTest() {
    if (!session || actionPending) return;
    const completedSession = session;
    actionPending = true;
    elements.nextCloze.disabled = true;
    try {
      const saved = await app.recordNotesTest({
        scope: completedSession.scope,
        subchapterId: completedSession.subchapterId,
        results: completedSession.results.map(result => ({
          clozeId: result.clozeId,
          sectionId: result.sectionId,
          correct: result.correct
        }))
      });
      if (session !== completedSession) return;
      const wrongIds = new Set(completedSession.results.filter(result => !result.correct).map(result => result.clozeId));
      const wrongGroups = completedSession.groups
        .map(group => {
          const clozes = group.clozes.filter(cloze => wrongIds.has(cloze.id));
          return { ...group, clozes, wordOrder: shuffled(clozes.map(cloze => cloze.id)) };
        })
        .filter(group => group.clozes.length);
      refreshNotesState();
      lastResult = {
        ...saved,
        subchapterId: completedSession.subchapterId,
        scope: completedSession.scope,
        wrongGroups,
        sectionCount: new Set(completedSession.results.map(result => result.sectionId)).size
      };
      renderResult();
      updateOverallProgress();
      renderLibrary();
      showOnly("result");
    } catch (error) {
      console.error("Testul de completare nu a putut fi salvat.", error);
      showToast("Rezultatul nu a putut fi salvat. Încearcă din nou.");
    } finally {
      actionPending = false;
      elements.nextCloze.disabled = false;
    }
  }

  function renderResult() {
    if (!lastResult) return;
    const wrongCount = lastResult.total - lastResult.correct;
    elements.resultIcon.textContent = lastResult.percentage === 100 ? "✓" : (lastResult.percentage >= 60 ? "↗" : "!");
    elements.resultSummary.textContent = lastResult.percentage === 100
      ? "Excelent — ai recuperat corect toate ideile din acest test."
      : wrongCount === 1
        ? "Ai o singură completare de consolidat. O poți repeta imediat."
        : `Ai ${formatNumber(wrongCount)} completări de consolidat. Repetă-le cât informația este încă proaspătă.`;
    elements.resultCorrect.textContent = `${formatNumber(lastResult.correct)} / ${formatNumber(lastResult.total)}`;
    elements.resultPercentage.textContent = formatPercentage(lastResult.percentage);
    elements.resultSections.textContent = formatNumber(lastResult.sectionCount);
    elements.repeatWrong.hidden = lastResult.wrongGroups.length === 0;
  }

  function returnToReader() {
    session = null;
    lastResult = null;
    if (selectedSubchapter) {
      openSubchapter(selectedSubchapter.id);
    } else {
      showOnly("library");
    }
  }

  function returnToLibrary() {
    session = null;
    lastResult = null;
    selectedSubchapter = null;
    setQuerySubchapter(null);
    renderLibrary();
    updateOverallProgress();
    showOnly("library");
  }

  function exitTest() {
    if (actionPending) {
      showToast("Rezultatul se salvează. Așteaptă o clipă.");
      return;
    }
    if (session?.results?.length && !global.confirm("Ieși din test? Răspunsurile acestui test nu vor fi salvate.")) return;
    returnToReader();
  }

  async function toggleSectionCompleted(sectionId, button) {
    if (actionPending) return;
    const complete = !isSectionComplete(sectionId);
    actionPending = true;
    button.disabled = true;
    try {
      await app.setNoteSectionCompleted(sectionId, complete);
      refreshNotesState();
      refreshSectionPresentation(sectionId);
      updateReaderProgress();
      updateOverallProgress();
      showToast(complete ? "Secțiunea a fost marcată ca parcursă." : "Marcajul secțiunii a fost eliminat.");
    } catch (error) {
      console.error("Starea secțiunii nu a putut fi salvată.", error);
      showToast("Modificarea nu a putut fi salvată.");
    } finally {
      actionPending = false;
      button.disabled = false;
    }
  }

  async function resetNotesProgress() {
    const confirmed = global.confirm(
      "Resetezi tot progresul notițelor?\n\nSe vor șterge secțiunile parcurse și statisticile testelor de completare. Grilele și flashcardurile nu sunt afectate."
    );
    if (!confirmed || actionPending) return;
    actionPending = true;
    elements.resetNotesProgress.disabled = true;
    try {
      await app.resetNotesProgress();
      refreshNotesState();
      viewedThisVisit.clear();
      updateOverallProgress();
      renderLibrary();
      showToast("Progresul notițelor a fost resetat.");
    } catch (error) {
      console.error("Progresul notițelor nu a putut fi resetat.", error);
      showToast("Progresul nu a putut fi resetat.");
    } finally {
      actionPending = false;
      elements.resetNotesProgress.disabled = false;
    }
  }

  function handleLibraryClick(event) {
    const chapterButton = event.target.closest("[data-toggle-chapter]");
    if (chapterButton) {
      toggleChapter(chapterButton.dataset.toggleChapter);
      return;
    }
    const openButton = event.target.closest("[data-open-subchapter]");
    if (openButton) {
      openSubchapter(openButton.dataset.openSubchapter);
      return;
    }
    const testButton = event.target.closest("[data-test-subchapter]");
    if (testButton) {
      const subchapter = app.noteSubchapterById.get(testButton.dataset.testSubchapter);
      startTest(subchapterTestGroups(subchapter), "subchapter", subchapter.id);
    }
  }

  function handleReaderClick(event) {
    const navButton = event.target.closest("[data-go-section]");
    if (navButton) {
      const section = app.noteSectionById.get(navButton.dataset.goSection);
      const article = elements.sectionList.querySelector(`[data-section-id="${CSS.escape(section.id)}"]`);
      if (article) {
        setSectionOpen(article, section, true);
        article.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
    const header = event.target.closest("[data-toggle-section]");
    if (header) {
      const section = app.noteSectionById.get(header.dataset.toggleSection);
      const article = header.closest(".note-section");
      setSectionOpen(article, section, !article.classList.contains("is-open"));
      return;
    }
    const completeButton = event.target.closest("[data-complete-section]");
    if (completeButton) {
      toggleSectionCompleted(completeButton.dataset.completeSection, completeButton);
      return;
    }
    const testButton = event.target.closest("[data-test-section]");
    if (testButton) {
      const section = app.noteSectionById.get(testButton.dataset.testSection);
      startTest(sectionTestGroups(section), "section", section.subchapterId);
    }
  }

  function bindEvents() {
    elements.materialSearch.addEventListener("input", renderLibrary);
    elements.chapterList.addEventListener("click", handleLibraryClick);
    elements.backToLibrary.addEventListener("click", returnToLibrary);
    elements.sectionSearch.addEventListener("input", renderReaderSections);
    elements.sectionNavigator.addEventListener("click", handleReaderClick);
    elements.sectionList.addEventListener("click", handleReaderClick);
    elements.startSubchapterTest.addEventListener("click", () => {
      if (selectedSubchapter) startTest(subchapterTestGroups(selectedSubchapter), "subchapter", selectedSubchapter.id);
    });
    elements.clozeForm.addEventListener("submit", checkCurrentAnswer);
    elements.clozePrompt.addEventListener("focusin", event => {
      if (event.target.matches(".recall-blank")) focusBlank(event.target);
    });
    elements.clozePrompt.addEventListener("input", event => {
      if (!event.target.matches(".recall-blank") || answerChecked) return;
      const termId = event.target.dataset.termId;
      const termButton = termId ? elements.wordBank.querySelector(`[data-term-id="${CSS.escape(termId)}"]`) : null;
      if (termButton && event.target.value !== termButton.dataset.termValue) {
        releaseTerm(termId);
        delete event.target.dataset.termId;
      }
      updateVerifyAvailability();
    });
    elements.wordBank.addEventListener("click", event => {
      const button = event.target.closest("[data-term-id]");
      if (button) chooseTerm(button);
    });
    elements.nextCloze.addEventListener("click", nextCloze);
    elements.exitTest.addEventListener("click", exitTest);
    elements.repeatWrong.addEventListener("click", () => {
      if (lastResult?.wrongGroups?.length) startTest(lastResult.wrongGroups, "mistakes", lastResult.subchapterId);
    });
    elements.returnToReader.addEventListener("click", returnToReader);
    elements.returnToLibrary.addEventListener("click", returnToLibrary);
    elements.resetNotesProgress.addEventListener("click", resetNotesProgress);
    document.addEventListener("keydown", event => {
      if (event.key === "Enter" && answerChecked && !elements.testView.hidden && !event.isComposing) {
        event.preventDefault();
        nextCloze();
      }
    });
  }

  function collectElements() {
    [
      "heroChapterCount", "heroSubchapterCount", "heroSectionCount", "heroClozeCount",
      "overallCoverage", "overallCompleted", "overallAccuracy", "overallProgressBar",
      "libraryView", "materialSearch", "libraryResultCount", "chapterList", "resetNotesProgress",
      "readerView", "backToLibrary", "sectionSearch", "startSubchapterTest", "readerChapter",
      "readerTitle", "readerSummary", "readerProgress", "readerProgressText", "readerProgressBar",
      "visibleSectionCount", "sectionNavigator", "sectionList", "sectionEmpty", "testView",
      "exitTest", "testProgressLabel", "testScoreLabel", "testProgressBar", "testSubchapter",
      "testTitle", "testPages", "clozePrompt", "clozeForm", "wordBankPanel", "wordBank", "checkAnswer",
      "clozeWarning", "clozeFeedback", "feedbackTitle", "feedbackAnswer", "feedbackSentence",
      "nextCloze", "resultView", "resultIcon", "resultSummary", "resultCorrect",
      "resultPercentage", "resultSections", "repeatWrong", "returnToReader", "returnToLibrary",
      "errorView", "errorMessage", "toast"
    ].forEach(id => {
      elements[id] = byId(id);
    });
  }

  async function init() {
    collectElements();
    try {
      if (!app) throw new Error("Motorul aplicației nu a fost încărcat.");
      await app.ready;
      if (!app.notesBank?.sections?.length || !app.notesBank?.subchapters?.length) {
        throw new Error("Banca de notițe este goală.");
      }
      refreshNotesState();
      updateOverallProgress();
      renderLibrary();
      bindEvents();
      const requestedSubchapter = new URLSearchParams(global.location.search).get("subchapter");
      if (requestedSubchapter && app.noteSubchapterById.has(requestedSubchapter)) {
        openSubchapter(requestedSubchapter);
      } else {
        showOnly("library");
      }
    } catch (error) {
      console.error("Pagina de notițe nu a putut fi inițializată.", error);
      elements.errorMessage.textContent = error?.message || "Reîncarcă pagina și încearcă din nou.";
      showOnly("error");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : globalThis);
