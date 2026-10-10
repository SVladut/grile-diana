"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const app = window.GrileApp;
  try {
    await app.ready;
  } catch (error) {
    const message = document.getElementById("formMessage");
    message.textContent = `${error.message} Deschide aplicația folosind „Grile Diana.exe”.`;
    message.hidden = false;
    document.querySelectorAll("button, input").forEach(control => { control.disabled = true; });
    return;
  }
  const bank = app.bank;

  const catalogRoot = document.getElementById("questionCatalog");
  document.querySelectorAll("#formSelectare > .capitol-grup").forEach(group => group.remove());

  const set1Chapters = bank.chapters.filter(chapter => Number(chapter.code) >= 1 && Number(chapter.code) <= 7);
  const set2Chapter = bank.chapters.find(chapter => chapter.id === "set-2");
  const historicalChapter = bank.chapters.find(chapter => chapter.id === "grile-anterioare");
  const subjectsChapter = bank.chapters.find(chapter => chapter.id === "subiecte-2021-2025");

  if (!catalogRoot || set1Chapters.length !== 7 || !set2Chapter || !historicalChapter || !subjectsChapter) {
    throw new Error("Catalogul de grile nu poate fi organizat în colecțiile Set 1, Set 2 și Subiecte.");
  }

  function collectionQuestionCount(groups) {
    return groups.reduce((total, group) => (
      total + group.subchapters.reduce((sum, subchapter) => sum + subchapter.questionCount, 0)
    ), 0);
  }

  const set1Groups = set1Chapters.map(chapter => ({
    id: `set1-capitol-${chapter.code}`,
    title: `Cap. ${chapter.code}. ${chapter.title}`,
    subchapters: chapter.subchapters
  }));
  const set2Groups = set1Chapters.map(chapter => ({
    id: `set2-capitol-${chapter.code}`,
    title: `Cap. ${chapter.code}. ${chapter.title}`,
    subchapters: set2Chapter.subchapters.filter(subchapter => subchapter.title.startsWith(`${chapter.code}.`))
  }));

  if (set2Groups.some(group => group.subchapters.length === 0) || set2Groups.flatMap(group => group.subchapters).length !== 72) {
    throw new Error("Cele 72 de subcapitole din Set 2 nu au putut fi împărțite în capitolele 1–7.");
  }

  const catalogCollections = [
    {
      id: "set-1",
      title: "SET 1",
      description: "Materia de bază, organizată în cele 7 capitole mari.",
      groups: set1Groups,
      detail: "7 capitole · 72 subcapitole"
    },
    {
      id: "set-2",
      title: "SET 2",
      description: "Noul set de grile, pe aceeași structură a materiei.",
      groups: set2Groups,
      detail: "7 capitole · 72 subcapitole"
    },
    {
      id: "subiecte-anterioare",
      title: "SUBIECTE ANTERIOARE",
      description: "Rezidențiat și simulări naționale, păstrate pe ani.",
      groups: [{
        id: "historical",
        title: "Rezidențiat și simulări",
        subchapters: historicalChapter.subchapters
      }],
      detail: "9 seturi de examen"
    },
    {
      id: "subiecte-2021-2025",
      title: "SUBIECTE 2021–2025 PE CAPITOLE",
      description: "Întrebările oficiale grupate după disciplina principală.",
      groups: [{
        id: "subjects",
        title: "Discipline",
        subchapters: subjectsChapter.subchapters
      }],
      detail: "7 discipline"
    }
  ];

  function createChapterGroup(group) {
    const targetId = `catalog-${group.id}`;
    const wrapper = document.createElement("div");
    wrapper.className = "capitol-grup";
    wrapper.dataset.groupId = group.id;

    const header = document.createElement("div");
    header.className = "capitol-header";
    const label = document.createElement("label");
    label.className = "capitol-mare";
    const master = document.createElement("input");
    master.type = "checkbox";
    master.className = "master-checkbox";
    master.dataset.target = targetId;
    const title = document.createElement("span");
    title.textContent = group.title;
    label.append(master, title);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "toggle-subcapitole";
    toggle.dataset.target = targetId;
    toggle.textContent = "▼";

    const subchapters = document.createElement("div");
    subchapters.className = "subcapitole hidden";
    subchapters.id = targetId;
    group.subchapters.forEach(subchapter => {
      const option = document.createElement("label");
      option.className = "chapter-option";
      option.dataset.subchapterId = subchapter.id;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "capitole";
      checkbox.value = subchapter.id;
      checkbox.dataset.subchapterId = subchapter.id;
      const optionTitle = document.createElement("span");
      optionTitle.textContent = subchapter.title;
      option.append(checkbox, optionTitle);
      subchapters.append(option);
    });

    header.append(label, toggle);
    wrapper.append(header, subchapters);
    return wrapper;
  }

  catalogCollections.forEach((collection, index) => {
    const bodyId = `collection-${collection.id}`;
    const wrapper = document.createElement("section");
    wrapper.className = "catalog-collection";
    wrapper.dataset.collectionId = collection.id;

    const header = document.createElement("div");
    header.className = "catalog-collection-header";
    const label = document.createElement("label");
    label.className = "collection-select";
    const master = document.createElement("input");
    master.type = "checkbox";
    master.className = "master-checkbox collection-master-checkbox";
    master.dataset.target = bodyId;
    const copy = document.createElement("span");
    copy.className = "collection-copy";
    const kicker = document.createElement("small");
    kicker.textContent = `Biblioteca ${index + 1}`;
    const title = document.createElement("strong");
    title.textContent = collection.title;
    const description = document.createElement("span");
    description.textContent = collection.description;
    copy.append(kicker, title, description);
    label.append(master, copy);

    const summary = document.createElement("span");
    summary.className = "collection-summary";
    const count = document.createElement("strong");
    count.textContent = `${collectionQuestionCount(collection.groups).toLocaleString("ro-RO")} grile`;
    const detail = document.createElement("small");
    detail.textContent = collection.detail;
    summary.append(count, detail);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "toggle-collection";
    toggle.dataset.target = bodyId;
    toggle.textContent = "▼";

    const body = document.createElement("div");
    body.className = `catalog-collection-body${index === 0 ? "" : " hidden"}`;
    body.id = bodyId;
    collection.groups.forEach(group => body.append(createChapterGroup(group)));

    header.append(label, summary, toggle);
    wrapper.append(header, body);
    catalogRoot.append(wrapper);
  });

  const switchBtn = document.getElementById("viewSwitch");
  const switchLabel = document.getElementById("switchLabel");
  const selectionModeLabel = document.getElementById("selectionModeLabel");
  const simulationModeLabel = document.getElementById("simulationModeLabel");
  const capitoleView = document.getElementById("capitole-container");
  const simulareView = document.getElementById("simulare-container");
  const formSelectare = document.getElementById("formSelectare");
  const selectedCount = document.getElementById("selectedCount");
  const selectedSummary = document.getElementById("selectedSummary");
  const numberInput = document.getElementById("numarIntrebari");
  const questionCountHint = document.getElementById("questionCountHint");
  const formMessage = document.getElementById("formMessage");
  const resumeBanner = document.getElementById("resumeBanner");
  const resumeSummary = document.getElementById("resumeSummary");
  const resumeSessionBtn = document.getElementById("resumeSessionBtn");
  const discardSessionBtn = document.getElementById("discardSessionBtn");
  const mistakesPanel = document.getElementById("mistakesPanel");
  const mistakesStatus = document.getElementById("mistakesStatus");
  const mistakesForm = document.getElementById("mistakesForm");
  const mistakeTestCount = document.getElementById("mistakeTestCount");
  const startMistakesBtn = document.getElementById("startMistakesBtn");
  const mistakesMessage = document.getElementById("mistakesMessage");
  const startSimulationBtn = document.getElementById("startSimulareBtn");
  const masterCheckboxes = [...document.querySelectorAll(".master-checkbox:not(.collection-master-checkbox)")];
  const collectionMasterCheckboxes = [...document.querySelectorAll(".collection-master-checkbox")];
  const chapterCheckboxes = [...document.querySelectorAll('input[name="capitole"]')];
  const flatCatalog = bank.chapters.flatMap(chapter => (
    chapter.subchapters.map(subchapter => ({ ...subchapter, chapterId: chapter.id }))
  ));
  const catalogById = new Map(flatCatalog.map(subchapter => [subchapter.id, subchapter]));
  const metrics = app.metricsByCatalog();

  if (flatCatalog.length !== chapterCheckboxes.length) {
    throw new Error(`Catalogul conține ${flatCatalog.length} subcapitole, dar pagina afișează ${chapterCheckboxes.length}.`);
  }

  document.getElementById("bankChapterCount").textContent = catalogCollections.length.toLocaleString("ro-RO");
  document.getElementById("bankSubchapterCount").textContent = bank.metadata.subchapterCount.toLocaleString("ro-RO");
  document.getElementById("bankQuestionCount").textContent = bank.metadata.questionCount.toLocaleString("ro-RO");

  function createMetric(label, value, variant) {
    const item = document.createElement("span");
    item.className = `metric-item metric-${variant}`;
    const number = document.createElement("strong");
    number.textContent = String(value);
    const caption = document.createElement("small");
    caption.textContent = label;
    item.append(number, caption);
    return item;
  }

  function createMetricsGroup(values, className) {
    const group = document.createElement("span");
    group.className = className;
    group.append(
      createMetric("Total", values.total, "total"),
      createMetric("Corecte", values.correct, "correct"),
      createMetric("Greșite", values.wrong, "wrong"),
      createMetric("Rămase", values.remaining, "remaining")
    );
    return group;
  }

  function metricsForSubchapters(subchapterIds) {
    return subchapterIds.reduce((total, subchapterId) => {
      const values = metrics.subchapters[subchapterId];
      total.total += values.total;
      total.correct += values.correct;
      total.wrong += values.wrong;
      total.remaining += values.remaining;
      return total;
    }, { total: 0, correct: 0, wrong: 0, remaining: 0 });
  }

  chapterCheckboxes.forEach(checkbox => {
    const subchapter = catalogById.get(checkbox.value);
    if (!subchapter) throw new Error(`Subcapitol necunoscut: ${checkbox.value}.`);
    const option = checkbox.closest(".chapter-option");
    const title = option?.querySelector(":scope > span");
    if (title) title.classList.add("chapter-option-title");
    option?.append(createMetricsGroup(metrics.subchapters[subchapter.id], "subchapter-metrics"));
  });

  masterCheckboxes.forEach(master => {
    const header = master.closest(".capitol-header");
    const toggleButton = header?.querySelector(".toggle-subcapitole");
    const targetId = master.dataset.target;
    const target = targetId ? document.getElementById(targetId) : null;
    const chapterName = header?.querySelector(".capitol-mare span")?.textContent?.trim() || "capitol";
    const subchapterIds = [...(target?.querySelectorAll('input[name="capitole"]') || [])].map(checkbox => checkbox.value);

    master.setAttribute("aria-label", `Selectează toate subcapitolele din ${chapterName}`);
    if (toggleButton) {
      toggleButton.before(createMetricsGroup(metricsForSubchapters(subchapterIds), "chapter-metrics"));
    }

    master.addEventListener("change", () => {
      target?.querySelectorAll('input[name="capitole"]').forEach(checkbox => {
        checkbox.checked = master.checked;
      });
      updateSelectionState();
    });
  });

  collectionMasterCheckboxes.forEach(master => {
    const targetId = master.dataset.target;
    const target = targetId ? document.getElementById(targetId) : null;
    const collectionName = master.closest(".catalog-collection-header")?.querySelector(".collection-copy strong")?.textContent?.trim() || "colecție";
    master.setAttribute("aria-label", `Selectează toate subcapitolele din ${collectionName}`);
    master.addEventListener("change", () => {
      target?.querySelectorAll('input[name="capitole"]').forEach(checkbox => {
        checkbox.checked = master.checked;
      });
      updateSelectionState();
    });
  });

  function selectedSubchapterIds() {
    return chapterCheckboxes.filter(checkbox => checkbox.checked).map(checkbox => checkbox.value);
  }

  function uniqueAvailableCount(subchapterIds) {
    if (!subchapterIds.length) return 0;
    return app.availableQuestionsForSubchapters(subchapterIds).length;
  }

  function updateSelectionState() {
    const selectedIds = selectedSubchapterIds();
    const available = uniqueAvailableCount(selectedIds);
    selectedCount.textContent = String(selectedIds.length);
    selectedSummary.textContent = selectedIds.length
      ? `${available.toLocaleString("ro-RO")} grile unice disponibile`
      : "subcapitole selectate";

    const effectiveMax = Math.max(1, available);
    numberInput.max = String(effectiveMax);
    questionCountHint.textContent = selectedIds.length
      ? `Poți genera între 1 și ${available.toLocaleString("ro-RO")} întrebări.`
      : "Selectează subcapitolele pentru a vedea numărul maxim de întrebări.";
    if (available && Number(numberInput.value) > effectiveMax) {
      numberInput.value = String(effectiveMax);
    }

    masterCheckboxes.forEach(master => {
      const targetId = master.dataset.target;
      if (!targetId) return;
      const children = [...document.querySelectorAll(`#${CSS.escape(targetId)} input[name="capitole"]`)];
      const checkedCount = children.filter(checkbox => checkbox.checked).length;
      master.checked = children.length > 0 && checkedCount === children.length;
      master.indeterminate = checkedCount > 0 && checkedCount < children.length;
    });

    collectionMasterCheckboxes.forEach(master => {
      const targetId = master.dataset.target;
      if (!targetId) return;
      const children = [...document.querySelectorAll(`#${CSS.escape(targetId)} input[name="capitole"]`)];
      const checkedCount = children.filter(checkbox => checkbox.checked).length;
      master.checked = children.length > 0 && checkedCount === children.length;
      master.indeterminate = checkedCount > 0 && checkedCount < children.length;
    });

    hideFormMessage();
  }

  function showFormMessage(message) {
    formMessage.textContent = message;
    formMessage.hidden = false;
  }

  function hideFormMessage() {
    formMessage.hidden = true;
    formMessage.textContent = "";
  }

  function showMistakesMessage(message) {
    mistakesMessage.textContent = message;
    mistakesMessage.hidden = false;
  }

  function hideMistakesMessage() {
    mistakesMessage.textContent = "";
    mistakesMessage.hidden = true;
  }

  function renderMistakesPanel() {
    const available = app.mistakeQuestions().length;
    mistakesPanel.classList.toggle("is-empty", available === 0);
    mistakeTestCount.disabled = available === 0;
    startMistakesBtn.disabled = available === 0;
    mistakeTestCount.max = String(Math.max(1, available));
    if (available > 0) {
      const currentCount = Number(mistakeTestCount.value);
      mistakeTestCount.value = String(Number.isInteger(currentCount) && currentCount > 0
        ? Math.min(currentCount, available)
        : Math.min(10, available));
      mistakesStatus.textContent = `${available.toLocaleString("ro-RO")} ${available === 1 ? "grilă greșită este pregătită" : "grile greșite sunt pregătite"} pentru recapitulare.`;
    } else {
      mistakeTestCount.value = "1";
      mistakesStatus.textContent = "Nu ai grile greșite active. Întrebările ratate vor apărea automat aici.";
    }
    hideMistakesMessage();
  }

  chapterCheckboxes.forEach(checkbox => checkbox.addEventListener("change", updateSelectionState));

  document.querySelectorAll(".toggle-subcapitole, .toggle-collection").forEach(button => {
    const targetId = button.dataset.target;
    const target = targetId ? document.getElementById(targetId) : null;
    const chapterName = button.classList.contains("toggle-collection")
      ? button.closest(".catalog-collection-header")?.querySelector(".collection-copy strong")?.textContent?.trim()
      : button.closest(".capitol-header")?.querySelector(".capitol-mare span")?.textContent?.trim();

    if (targetId) button.setAttribute("aria-controls", targetId);
    const initiallyExpanded = !!target && !target.classList.contains("hidden");
    button.classList.toggle("rotate", initiallyExpanded);
    button.setAttribute("aria-expanded", String(initiallyExpanded));
    button.setAttribute("aria-label", `Deschide ${chapterName || "capitolul"}`);

    button.addEventListener("click", () => {
      if (!target) return;
      target.classList.toggle("hidden");
      button.classList.toggle("rotate");
      const expanded = !target.classList.contains("hidden");
      button.setAttribute("aria-expanded", String(expanded));
      button.setAttribute("aria-label", `${expanded ? "Închide" : "Deschide"} ${chapterName || "capitolul"}`);
    });
  });

  function setMode(simulationMode) {
    switchLabel.textContent = simulationMode ? "Configurare Simulare" : "Selectare Capitole";
    selectionModeLabel.classList.toggle("active", !simulationMode);
    simulationModeLabel.classList.toggle("active", simulationMode);
    capitoleView.classList.toggle("active-view", !simulationMode);
    capitoleView.classList.toggle("hidden-view", simulationMode);
    simulareView.classList.toggle("active-view", simulationMode);
    simulareView.classList.toggle("hidden-view", !simulationMode);
  }

  switchBtn.addEventListener("change", () => setMode(switchBtn.checked));

  function confirmSessionReplacement() {
    const activeSession = app.getSession();
    if (!activeSession || activeSession.status !== "active") return true;
    return window.confirm("Există deja un test în desfășurare. Vrei să renunți la el și să generezi unul nou?");
  }

  async function startSession(session) {
    await app.saveSession(session);
    window.location.href = "quizz.html";
  }

  formSelectare.addEventListener("submit", async event => {
    event.preventDefault();
    hideFormMessage();
    if (!confirmSessionReplacement()) return;

    try {
      const session = app.createPracticeSession(selectedSubchapterIds(), Number(numberInput.value));
      await startSession(session);
    } catch (error) {
      showFormMessage(error.message);
    }
  });

  mistakesForm.addEventListener("submit", async event => {
    event.preventDefault();
    hideMistakesMessage();
    if (!confirmSessionReplacement()) return;

    try {
      const session = app.createMistakeSession(Number(mistakeTestCount.value));
      await startSession(session);
    } catch (error) {
      showMistakesMessage(error.message);
    }
  });

  startSimulationBtn.addEventListener("click", async () => {
    hideFormMessage();
    if (!confirmSessionReplacement()) return;

    try {
      await startSession(app.createExamSession());
    } catch (error) {
      window.alert(error.message);
    }
  });

  function renderResumeBanner() {
    const session = app.getSession();
    if (!session || session.status !== "active") {
      resumeBanner.hidden = true;
      return;
    }
    const stats = app.sessionStats(session);
    resumeBanner.hidden = false;
    const modeLabel = session.mode === "exam"
      ? "Simulare"
      : session.mode === "mistakes" ? "Test din greșeli" : "Test personalizat";
    resumeSummary.textContent = `${modeLabel}: ${stats.answered} din ${stats.total} întrebări rezolvate.`;
  }

  resumeSessionBtn.addEventListener("click", () => {
    window.location.href = "quizz.html";
  });

  discardSessionBtn.addEventListener("click", async () => {
    if (!window.confirm("Sigur vrei să renunți la testul aflat în desfășurare?")) return;
    try {
      await app.clearSession();
      renderResumeBanner();
    } catch (error) {
      showFormMessage(error.message);
    }
  });

  updateSelectionState();
  renderMistakesPanel();
  renderResumeBanner();
  setMode(false);
});
