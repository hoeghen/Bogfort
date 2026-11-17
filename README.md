# Bogført

Enkel, lovmedholdelig bogføring for små danske virksomheder og foreninger.
Kravspecifikationen ligger i [`docs/kravspecifikation.pdf`](docs/kravspecifikation.pdf).

## Status: fase 1 — fundament og kassekladde

- **Kassekladde** (UC-1): vælg konto, skriv beløb inkl. moms, tekst, dato, vedhæft bilag.
  Modkonto og moms udledes af kontoen og kan ændres bag "Ændr". Kladden virker offline;
  bilag venter i en lokal kø og uploades, når der er forbindelse.
- **Bogføring**: Cloud Function laver dobbelt bogholderi (debet = kredit), giver fortløbende
  bilagsnummer uden huller, kopierer bilaget til `bilag/{vrid}/{år}/{post-id}` og gemmer dets
  SHA-256. Hver postering hash-kædes til den forrige.
- **Uforanderlighed**: bogførte posteringer kan hverken rettes eller slettes — kun
  modposteres, og kun én gang.
- **Standardkontoplan og momsregler** oprettes automatisk ved første login.
- **Skjult opsætning** (tandhjulet): virksomhedsdata, kontoplan, momsregler, regnskabsår
  og revisionsspor (UC-5).
- **Roller**: `owner` / `bookkeeper` / `auditor` håndhæves allerede i regler og funktioner;
  MVP'en kører med én ejer.

Næste fase: rapporter (moms, resultat, balance), dashboard, udeståender, SAF-T-eksport,
årsafslutning og arkivering til låst bucket.

## Udvikling

Kræver Node 22 og Java 21 (til emulatorerne).

```sh
npm install && npm --prefix functions install
cp .env.example .env.local
npm --prefix functions run build
npm run emulators      # terminal 1
npm run dev            # terminal 2 → http://localhost:5173
```

```sh
npm test               # enhedstests + regler + Cloud Functions mod emulatorerne
npm run typecheck
```

Opsætning af det rigtige Firebase-projekt: [`docs/infrastruktur.md`](docs/infrastruktur.md).
