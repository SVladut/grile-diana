# Grile Diana

Site web pentru pregătirea la rezidențiat stomatologie. Include teste, flashcarduri, notițe și profil cu progres.

## Folosire locală

Este necesar Node.js 18 sau mai nou:

```sh
node server.js
```

Deschide apoi `http://127.0.0.1:3001`. Progresul local este păstrat în `data/diana-state.json`.

## Publicare pe GitHub Pages

Workflow-ul din `.github/workflows/pages.yml` publică automat interfața și băncile de conținut la fiecare push pe `main`.

În repository, deschide **Settings → Pages** și setează **Build and deployment → Source** la **GitHub Actions**. După publicare, site-ul va fi disponibil la:

`https://svladut.github.io/grile-diana/`

Pe site-ul public, progresul este salvat în memoria locală a browserului de pe fiecare dispozitiv; nu se sincronizează și nu este trimis către server. Progresul local `data/diana-state.json`, fișierele-sursă JSON, arhivele și executabilele Windows nu sunt incluse în repository.
