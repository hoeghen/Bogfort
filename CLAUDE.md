# Bogført — projektkontekst

Spec: `docs/kravspecifikation.pdf`. Infrastruktur: `docs/infrastruktur.md`.

## Stack

React + Vite + TypeScript + Tailwind v4, PWA (vite-plugin-pwa). Firebase: Auth,
Firestore (persistent cache), Cloud Functions v2 (europe-west1), Storage.

## Invarianter — korrekthed, ikke smag

1. **Klienter skriver kun kassekladden.** `drafts` er den eneste samling en klient må
   skrive. Posteringer, tæller, regnskabsår, revisionsspor, medlemmer/roller og
   indstillinger skrives kun af Cloud Functions. Indstillinger går gennem funktioner,
   så hver ændring logges.
2. **Bogførte posteringer er uforanderlige.** Ingen update/delete — heller ikke i
   funktioner. Rettelser er en ny postering via `reverseTransaction`, maks. én pr. original
   (`reversals/{postId}` oprettes med `tx.create` i samme transaktion).
3. **Bilagsnumre er fortløbende og uden huller.** Nummeret tages fra
   `counters/vouchers` inde i samme Firestore-transaktion, som skriver posteringen.
   Valideringsfejl skal ske før/inde i transaktionen, så et nummer aldrig spildes.
4. **Debet = kredit**, i øre som heltal. `buildPostingLines` (src/shared) er den eneste
   vej til linjer, og den kører både i appen (forhåndsvisning) og i funktionen.
5. **Revisionsspor i samme transaktion** som ændringen (`writeAudit`).
6. **SHA-256 beregnes på serveren** af de faktiske bytes i Storage, aldrig taget fra klienten.
7. **Kontonummer og -type kan ikke ændres** efter oprettelse; konti slettes aldrig, kun deaktiveres.
   Posteringer gemmer momssatsen, de blev bogført med.

## Konventioner

- Delte typer og logik i `src/shared/` — importeres af både app og `functions/`.
- Firestore-adgang i appen går gennem `src/lib/data.ts`.
- Penge: øre (heltal). Satser: basispunkter (2500 = 25 %). Bogføringsdatoer: `YYYY-MM-DD`
  i dansk tid (`todayIso`).
- UI-tekst på dansk; fejl fra funktioner er danske og vises direkte.
- Daglig drift (Kassekladde, Posteringer) i navigationen; alt andet bag tandhjulet.
- Hver funktion, der ændrer bogføringsdata, har en emulator-test.
- Udvikl mod Emulator Suite, aldrig mod det rigtige projekt.
