# Specificație funcțională — mecanismul de grile și punctaj

Acest document descrie comportamentul implementat în versiunea actuală a site-ului **Grile Diana**, astfel încât mecanismul să poată fi reprodus într-o altă aplicație. Sursa de adevăr pentru reguli este `app-core.js`; interfața testului este în `quiz.js`, selecția testului în `selectare.js`, iar persistența în `file-store.js` și `server.js`.

## 1. Imagine de ansamblu

Aplicația are următorul flux pentru grile:

1. În pagina de selectare, utilizatorul pornește unul dintre cele trei tipuri de test:
   - test personalizat din subcapitole (`practice`);
   - simulare de examen (`exam`);
   - recapitulare din grilele greșite (`mistakes`).
2. Se generează și se salvează o sesiune care conține ID-urile întrebărilor, coada de întrebări, răspunsurile și cronometrul, dacă este cazul.
3. În pagina de quiz se afișează câte o întrebare. Răspunsul este evaluat și salvat imediat.
4. După evaluare, utilizatorul vede punctajul întrebării, selecția sa și, dacă nu a răspuns integral corect, răspunsul corect.
5. La final se recalculează rezultatul din toate răspunsurile sesiunii, se salvează în istoric și se afișează recapitularea.

În versiunea analizată, banca are 13.321 întrebări: 4.041 CS și 9.280 CM, organizate în 10 capitole și 160 de subcapitole.

## 2. Structura unei întrebări

Formatul logic folosit de aplicație este:

```json
{
  "id": "1.01-1",
  "fingerprint": "42099022a57aa6fc",
  "chapterId": "capitol-1",
  "subchapterId": "1.01",
  "type": "CS",
  "text": "Textul întrebării",
  "options": [
    { "id": "A", "text": "Varianta A" },
    { "id": "B", "text": "Varianta B" },
    { "id": "C", "text": "Varianta C" },
    { "id": "D", "text": "Varianta D" },
    { "id": "E", "text": "Varianta E" }
  ],
  "correct": ["C"],
  "pages": [123],
  "source": "set-2"
}
```

Câmpurile obligatorii pentru mecanism sunt:

- `id`: identificator unic al înregistrării;
- `fingerprint`: identifică întrebarea din punct de vedere al conținutului și este folosit pentru eliminarea duplicatelor;
- `chapterId` și `subchapterId`: permit filtrarea și statisticile pe materie;
- `type`: `CS` sau `CM`;
- `options`: cele cinci variante, cu ID-urile fixe `A`, `B`, `C`, `D`, `E`;
- `correct`: lista ID-urilor variantelor corecte.

`pages` și `source` sunt opționale pentru punctaj; sunt folosite pentru contextul afișat în interfață.

Invariante recomandate la importul băncii:

- o întrebare are exact opțiunile A–E, fără duplicate;
- `correct` conține numai ID-uri existente în `options`;
- pentru CS, `correct` conține exact un element;
- pentru CM, `correct` conține între 1 și 4 variante;
- `id` este unic;
- întrebările cu același `fingerprint` sunt considerate duplicate la generarea unui test.

## 3. Normalizarea răspunsului

Înainte de validare și punctare, selecția utilizatorului este normalizată astfel:

1. dacă valoarea nu este listă, devine listă goală;
2. toate valorile sunt transformate în text și în majuscule;
3. sunt păstrate numai `A`, `B`, `C`, `D`, `E`;
4. duplicatele sunt eliminate;
5. rezultatul este sortat în ordinea A, B, C, D, E.

Exemplu: `["c", "A", "C", "X"]` devine `["A", "C"]`.

Două răspunsuri sunt considerate identice dacă listele normalizate au aceeași lungime și aceleași elemente în aceeași ordine. `fullyCorrect` este adevărat numai când selecția normalizată este exact egală cu `correct`.

## 4. Regula exactă de punctare

### 4.1. CS — complement simplu

La CS poate fi selectată exact o variantă.

- răspuns exact corect: **4 puncte din 4**;
- orice răspuns greșit: **0 puncte din 4**;
- fără răspuns la finalul testului: **0 puncte din 4**.

Formula este:

```text
scoreCS = selection == correct ? 4 : 0
maxScoreCS = 4
fullyCorrect = selection == correct
```

Nu există punctaj parțial și nu există puncte negative.

### 4.2. CM — complement multiplu

La CM sunt evaluate separat toate cele cinci opțiuni A–E. Pentru fiecare opțiune se acordă 1 punct dacă utilizatorul a tratat-o corect:

- opțiune corectă și bifată: +1;
- opțiune incorectă și nebifată: +1;
- opțiune corectă, dar nebifată: +0;
- opțiune incorectă, dar bifată: +0.

Prin urmare, o opțiune incorectă lăsată nebifată contribuie și ea cu un punct. Echivalent, pentru o selecție permisă:

```text
scoreCM = 5 - număr_variante_corecte_omise - număr_variante_incorecte_bifate
maxScoreCM = 5
```

Există două excepții obligatorii:

- nicio variantă bifată = **0 puncte din 5**;
- toate cele 5 variante bifate = **0 puncte din 5**.

Formula completă este:

```text
dacă selection.length este 0 sau 5:
    scoreCM = 0
altfel:
    scoreCM = suma pentru A..E a valorii:
              1 dacă selected(option) == correct(option), altfel 0

maxScoreCM = 5
fullyCorrect = selection == correct
```

Pentru o selecție de 1–4 variante, `fullyCorrect` rămâne o comparație exactă, independentă de punctajul parțial. Excepțiile „nimic” și „toate” forțează și `fullyCorrect=false`. De aceea, cheia `correct` a unei întrebări CM trebuie să conțină între 1 și 4 variante. O grilă CM cu 4/5 puncte este considerată **greșită**, nu corectă.

### 4.3. Exemple CM

Presupunem că răspunsul corect este `["A", "C", "E"]`.

| Selecție | Potriviri evaluate corect | Punctaj | Integral corectă |
|---|---:|---:|---|
| `A, C, E` | toate cele 5 opțiuni | 5/5 | da |
| `A, C` | A și C bifate corect; B și D nebifate corect | 4/5 | nu |
| `A, D` | A bifată corect; B nebifată corect | 2/5 | nu |
| `B` | numai D este tratată corect | 1/5 | nu |
| nimic | excepția „nicio variantă” | 0/5 | nu |
| `A, B, C, D, E` | excepția „toate variantele” | 0/5 | nu |

Observație importantă: interfața curentă nu permite trimiterea unei întrebări CM fără nicio selecție; utilizatorul trebuie să bifeze cel puțin una sau să folosească „Mai târziu”. Totuși, lista goală este punctată cu 0 la calculul final pentru întrebările rămase fără răspuns.

## 5. Calculul rezultatului unui test

La final, aplicația iterează prin toate ID-urile din `session.questionIds`, în ordinea inițială:

1. verifică dacă există cheia întrebării în `session.answers`;
2. dacă există, punctează selecția salvată;
3. dacă nu există, punctează lista goală;
4. însumează punctajul și punctajul maxim;
5. construiește detaliul fiecărei întrebări.

Formulele agregate sunt:

```text
totalQuestions    = numărul întrebărilor din sesiune
answeredCount     = numărul întrebărilor care au o cheie în session.answers
unansweredCount   = totalQuestions - answeredCount
correctCount      = numărul întrebărilor cu fullyCorrect == true
wrongCount        = answeredCount - correctCount
score             = suma punctajelor obținute
maxScore          = 4 × număr_CS + 5 × număr_CM
percentage        = rotunjire_la_o_zecimală(score / maxScore × 100)
```

Rotunjirea procentului reproduce expresia JavaScript:

```js
Math.round((score / maxScore) * 1000) / 10
```

Exemplu: `4 / 14 × 100 = 28,571...`, afișat `28,6%`.

Diferența dintre indicatori este importantă:

- `score` include punctele parțiale de la CM;
- `correctCount` include numai răspunsurile integral corecte;
- `wrongCount` include răspunsurile trimise care nu sunt integral corecte, inclusiv un CM de 4/5;
- `unansweredCount` este separat de `wrongCount`, deși întrebările fără răspuns primesc 0 puncte;
- aplicația nu implementează prag de promovare, notă din oficiu sau penalizare negativă.

Detaliul rezultatului are forma:

```json
{
  "totalQuestions": 3,
  "answeredCount": 2,
  "unansweredCount": 1,
  "correctCount": 1,
  "wrongCount": 1,
  "score": 8,
  "maxScore": 14,
  "percentage": 57.1,
  "details": [
    {
      "questionId": "q1",
      "answered": true,
      "selection": ["C"],
      "score": 4,
      "maxScore": 4,
      "fullyCorrect": true
    },
    {
      "questionId": "q2",
      "answered": true,
      "selection": ["A", "C"],
      "score": 4,
      "maxScore": 5,
      "fullyCorrect": false
    },
    {
      "questionId": "q3",
      "answered": false,
      "selection": [],
      "score": 0,
      "maxScore": 5,
      "fullyCorrect": false
    }
  ]
}
```

## 6. Generarea testelor

### 6.1. Eliminarea duplicatelor și amestecarea

Funcția comună de selecție:

1. amestecă aleator lista candidată prin algoritmul Fisher–Yates;
2. păstrează doar prima apariție a fiecărui `fingerprint`;
3. returnează lista unică deja amestecată.

Aleatorizarea folosește `crypto.getRandomValues` cu eliminarea biasului modulo când API-ul este disponibil și `Math.random` ca rezervă.

Consecință: două înregistrări cu ID-uri diferite, dar același `fingerprint`, nu pot apărea împreună în același test generat prin acest mecanism.

### 6.2. Test personalizat (`practice`)

1. se elimină ID-urile de subcapitol duplicate și necunoscute;
2. trebuie să rămână cel puțin un subcapitol valid;
3. se filtrează banca după subcapitolele selectate;
4. rezultatul este amestecat și deduplicat după `fingerprint`;
5. numărul cerut trebuie să fie întreg și cel puțin 1;
6. numărul cerut nu poate depăși numărul de întrebări unice disponibile;
7. se iau primele `requestedCount` întrebări.

### 6.3. Simulare (`exam`)

- se creează separat o listă unică și amestecată de CS și una de CM;
- banca trebuie să conțină minimum 50 CS și 150 CM unice;
- se aleg 50 CS și 150 CM;
- ordinea actuală este cele 50 CS urmate de cele 150 CM; lista finală nu mai este amestecată global;
- durata este de 240 minute, calculată din momentul creării sesiunii;
- cronometrul nu se pune pe pauză la închiderea paginii;
- punctajul maxim este `50 × 4 + 150 × 5 = 950` puncte.

### 6.4. Test din greșeli (`mistakes`)

1. sunt selectate numai întrebările cu `mistakes.questions[id].status == "active"`;
2. întrebările care nu mai există în banca actuală sunt ignorate;
3. lista este amestecată și deduplicată după `fingerprint`;
4. numărul cerut trebuie să fie întreg, minimum 1 și maximum numărul disponibil;
5. întrebările alese formează o sesiune normală cu modul `mistakes`.

## 7. Structura și ciclul de viață al sesiunii

Structura relevantă este:

```json
{
  "version": 1,
  "id": "uuid-sesiune",
  "mode": "practice",
  "status": "active",
  "createdAt": 1700000000000,
  "updatedAt": 1700000000000,
  "completedAt": null,
  "durationSeconds": 0,
  "endsAt": null,
  "questionIds": ["q1", "q2", "q3"],
  "selectedSubchapterIds": ["1.01"],
  "requestedCount": 3,
  "currentQuestionId": "q1",
  "pendingQuestionIds": ["q2", "q3"],
  "answers": {},
  "presented": { "q1": 1 },
  "deferred": {},
  "result": null
}
```

Pentru simulare, `durationSeconds` este `14400`, iar `endsAt = createdAt + 14400 × 1000`. Pentru celelalte moduri, durata este 0 și `endsAt` este `null`.

### 7.1. Trimiterea unui răspuns

Validarea dinaintea salvării este:

- CS: trebuie selectată exact o variantă;
- CM: trebuie selectată cel puțin o variantă;
- selecția tuturor celor 5 variante CM poate fi trimisă, dar interfața avertizează că valorează 0 puncte.

După trimitere, în aceeași operație logică:

1. se calculează punctajul întrebării;
2. se actualizează progresul permanent al întrebării;
3. se actualizează lista de greșeli;
4. selecția normalizată este salvată în `session.answers[question.id]`;
5. întrebarea următoare este scoasă din începutul cozii;
6. sesiunea și starea completă sunt persistate;
7. utilizatorul primește feedback imediat;
8. dacă nu mai există întrebare în coadă, sesiunea este finalizată automat cu motivul `answered`.

În timpul feedbackului, răspunsurile sunt dezactivate. Utilizatorul trebuie să apese „Următoarea întrebare”; nu își poate modifica răspunsul deja salvat în sesiunea respectivă.

### 7.2. „Mai târziu”

Butonul mută întrebarea curentă la sfârșitul cozii fără răspuns și incrementează `deferred[questionId]`. Întrebarea poate reveni de mai multe ori. Numărul de prezentări este ținut în `presented[questionId]`.

După ce toate întrebările au fost afișate cel puțin o dată, dacă mai există întrebări fără răspuns, devine disponibilă finalizarea manuală. Aceste întrebări primesc 0 puncte, dar nu sunt înregistrate ca încercări greșite în progresul permanent.

### 7.3. Finalizarea

Sesiunea se poate încheia prin:

- răspunderea la ultima întrebare din coadă: `answered`;
- finalizare manuală cu întrebări fără răspuns: `manual-with-unanswered`;
- expirarea celor 240 minute ale simulării: `time-expired`;
- apel explicit din altă interfață: motiv implicit `manual`.

La final:

- `status` devine `completed`;
- sunt setate `completedAt` și `updatedAt`;
- `currentQuestionId` devine `null`;
- coada este golită;
- rezultatul complet este recalculat;
- intrarea de istoric este inserată sau înlocuită după ID-ul sesiunii;
- istoricul este sortat descrescător după `completedAt`.

## 8. Progresul permanent și lista de greșeli

Progresul unei întrebări este actualizat numai când utilizatorul trimite un răspuns:

```json
{
  "status": "wrong",
  "attempts": 3,
  "correctAttempts": 1,
  "wrongAttempts": 2,
  "lastScore": 4,
  "lastMaxScore": 5,
  "lastAnsweredAt": 1700000000000
}
```

Reguli:

- `status` descrie ultimul răspuns, nu performanța istorică;
- orice punctaj parțial are status `wrong`;
- `attempts` crește la fiecare răspuns trimis;
- `correctAttempts` crește numai pentru `fullyCorrect`;
- `wrongAttempts` crește pentru orice răspuns care nu este integral corect;
- `lastScore` poate fi mai mare ca 0 chiar dacă statusul este `wrong`.

Lista separată de greșeli funcționează astfel:

- la un răspuns care nu este integral corect, întrebarea primește status `active`;
- se păstrează momentul primei greșeli în `firstWrongAt`;
- se actualizează `lastWrongAt`, se incrementează `wrongAttempts`, iar `resolvedAt` devine `null`;
- la un răspuns ulterior integral corect, dacă întrebarea exista în listă, statusul devine `mastered` și se setează `resolvedAt`;
- dacă este greșită din nou, revine la `active`;
- numai statusul `active` intră în testele de recapitulare.

Metricile din pagina de selectare (`Corecte`, `Greșite`, `Rămase`) folosesc doar ultimul status al fiecărei întrebări:

```text
correct   = întrebări cu status curent "correct"
wrong     = întrebări cu status curent "wrong"
remaining = total - correct - wrong
```

## 9. Persistența datelor

Aplicația curentă rulează local cu un server Node.js:

- clientul citește starea cu `GET /api/state`;
- clientul salvează întreaga stare cu `PUT /api/state` și `Content-Type: application/json`;
- serverul validează structura;
- `revision` implementează control optimist al concurenței: o salvare cu o revizie veche primește HTTP 409;
- la salvare, serverul incrementează `revision` și actualizează `updatedAt`;
- fișierul este scris atomic într-un fișier temporar, sincronizat și apoi redenumit peste `data/diana-state.json`;
- operațiile de scriere sunt serializate într-o coadă.

Scheletul stării globale este:

```json
{
  "schema": "grile-diana-state",
  "version": 1,
  "revision": 0,
  "updatedAt": null,
  "progress": {
    "version": 1,
    "updatedAt": null,
    "questions": {}
  },
  "mistakes": {
    "version": 1,
    "updatedAt": null,
    "questions": {}
  },
  "history": [],
  "session": null
}
```

Implementarea reală mai include `flashcards` și `notes`, dar acestea nu influențează mecanismul grilelor sau punctajul.

Într-un alt site, aceeași structură poate fi păstrată într-o bază de date. Important este ca salvarea răspunsului, actualizarea progresului, actualizarea greșelilor și actualizarea sesiunii să fie tratate ca o singură tranzacție.

## 10. Pseudocod portabil pentru evaluator

```js
const OPTIONS = ["A", "B", "C", "D", "E"];

function normalizeSelection(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(String).map(x => x.toUpperCase()))]
    .filter(x => OPTIONS.includes(x))
    .sort((a, b) => OPTIONS.indexOf(a) - OPTIONS.indexOf(b));
}

function equalSelections(a, b) {
  const left = normalizeSelection(a);
  const right = normalizeSelection(b);
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function scoreQuestion(question, rawSelection) {
  const selection = normalizeSelection(rawSelection);
  const fullyCorrect = equalSelections(selection, question.correct);

  if (question.type === "CS") {
    return {
      score: fullyCorrect ? 4 : 0,
      maxScore: 4,
      fullyCorrect,
      selection
    };
  }

  if (selection.length === 0 || selection.length === OPTIONS.length) {
    return { score: 0, maxScore: 5, fullyCorrect: false, selection };
  }

  const selected = new Set(selection);
  const correct = new Set(question.correct);
  const score = OPTIONS.reduce((sum, option) =>
    sum + (selected.has(option) === correct.has(option) ? 1 : 0), 0);

  return { score, maxScore: 5, fullyCorrect, selection };
}

function calculateResult(session, questionsById) {
  let score = 0;
  let maxScore = 0;
  let answeredCount = 0;
  let correctCount = 0;

  const details = session.questionIds.map(questionId => {
    const question = questionsById.get(questionId);
    const answered = Object.hasOwn(session.answers, questionId);
    const item = scoreQuestion(
      question,
      answered ? session.answers[questionId] : []
    );

    score += item.score;
    maxScore += item.maxScore;
    if (answered) answeredCount += 1;
    if (item.fullyCorrect) correctCount += 1;

    return { questionId, answered, ...item };
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
```

## 11. Cazuri de test obligatorii la transpunere

Pentru a confirma că noul site reproduce exact comportamentul, cazurile CM de mai jos pot folosi cheia corectă `["A", "C", "E"]`:

1. CS corect → 4/4 și `fullyCorrect=true`.
2. CS greșit → 0/4 și `fullyCorrect=false`.
3. CS fără răspuns la final → 0/4, `answered=false`.
4. CM exact → 5/5 și `fullyCorrect=true`.
5. CM cu o singură omisiune → 4/5 și status greșit.
6. CM cu o singură bifă incorectă în plus → 4/5 și status greșit.
7. CM fără selecție → 0/5.
8. CM cu toate opțiunile selectate → 0/5.
9. O întrebare CM de 4/5 crește `wrongAttempts`, nu `correctAttempts`.
10. O întrebare greșită devine `active` în lista de greșeli.
11. Aceeași întrebare, rezolvată apoi exact, devine `mastered`.
12. O întrebare amânată și lăsată fără răspuns primește 0 în rezultat, dar nu creează o încercare în progres.
13. Un test mixt are `maxScore = 4 × CS + 5 × CM`.
14. Procentul este rotunjit la precizie de o zecimală; fiind număr, poate fi afișat fără zero final (`40`, nu obligatoriu `40,0`).
15. Două întrebări cu același `fingerprint` nu apar în aceeași selecție generată.
16. Simularea conține 50 CS, apoi 150 CM, are maximum 950 puncte și expiră la 240 minute de la creare.

## 12. Fișierele relevante din proiectul actual

- `data/question-bank.js` — banca de întrebări și structura capitolelor;
- `selectare.js` — catalogul, filtrele și pornirea celor trei tipuri de sesiune;
- `app-core.js` — generarea, normalizarea, punctarea, progresul, greșelile, sesiunile și istoricul;
- `quiz.js` — interfața întrebării, feedbackul, amânarea, cronometrul și rezultatul;
- `file-store.js` — clientul de persistență pentru `/api/state`;
- `server.js` — validarea și salvarea atomică a stării;
- `data/diana-state.json` — starea locală persistentă.

Pentru o transpunere fidelă, evaluatorul din secțiunea 10 trebuie să fie unica sursă de adevăr folosită atât la feedbackul imediat, cât și la recalcularea rezultatului final.
