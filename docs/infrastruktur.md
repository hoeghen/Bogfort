# Infrastruktur (fase 2)

Det, der ikke kan ligge i koden, og som skal sættes op én gang i GCP/Firebase.

## 1. Projekt

1. Opret et Firebase-projekt (region **europe-west1** for Firestore, Functions og Storage — data bliver i EU).
2. Aktivér **Authentication → E-mail/adgangskode**.
3. Opret Firestore (Native mode) og Cloud Storage (standardbucket).
4. Opgrader til Blaze (Cloud Functions kræver det).

## 2. 2FA

Firebase Auth understøtter TOTP-baseret flerfaktor, men kun efter opgradering til
**Identity Platform** (Authentication → Settings → Upgrade). Datamodel og login er
allerede e-mail/adgangskode, som er forudsætningen; selve tilmeldingsflowet til TOTP
bygges i næste fase.

## 3. Arkivbucket med Retention Lock (spec §6)

Arkivbucketten er adskilt fra standardbucketten, fordi en retention lock gælder hele
bucketten og ikke kan fjernes igen. Den bruges af arkiveringsrutinen (næste fase).

```sh
PROJECT=<projekt-id>
BUCKET=gs://$PROJECT-arkiv

gcloud storage buckets create $BUCKET --project=$PROJECT --location=europe-west1 \
  --uniform-bucket-level-access --public-access-prevention
# 6 år: 5 års opbevaringspligt + det igangværende regnskabsår.
gcloud storage buckets update $BUCKET --retention-period=6y
# IRREVERSIBELT: når låsen er sat, kan politikken kun forlænges, aldrig forkortes eller fjernes.
gcloud storage buckets update $BUCKET --lock-retention-period
```

Lås først, når politikken er testet — en låst bucket kan ikke slettes, før det sidste
objekt er udløbet.

Standardbucketten (aktive bilag) beskyttes i mellemtiden af `storage.rules`: ingen klient
kan skrive eller slette en bogført bilagsfil, og hver fil har sin SHA-256 i posteringen.
Slå desuden **Object Versioning** og **Soft delete** til på standardbucketten som net under
administratorfejl:

```sh
gcloud storage buckets update gs://<standardbucket> --versioning --soft-delete-duration=90d
```

## 4. CI/CD

`.github/workflows/deploy-firebase.yml` deployer ved push til `main`, når følgende er sat
i GitHub-repoets indstillinger:

| Type     | Navn                                  |
|----------|---------------------------------------|
| Variable | `FIREBASE_PROJECT_ID`                 |
| Secret   | `FIREBASE_SERVICE_ACCOUNT` (JSON-nøgle med Firebase Admin + Cloud Functions Admin + Service Account User) |
| Secret   | `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` |

Indtil `FIREBASE_PROJECT_ID` er sat, springer workflowet sig selv over i stedet for at fejle.
`ci.yml` kører typecheck, build og alle tests (inkl. emulator) ved hvert push.

## 5. Storage-regler læser Firestore

`storage.rules` slår medlemskab op i Firestore (`firestore.get`). Første deploy af
reglerne beder om at give Storage-tjenesten adgang til Firestore — sig ja.
