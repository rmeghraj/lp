# Claims Intelligence Engine: assessment slice

An evaluator pastes a cosmetic **claim** (for example *"Reduces wrinkles by 20% in 4 weeks"*) and the text of a **clinical study**.
The system answers **Justified: Yes/No, a confidence score and the reasoning**, and stores every answer for audit.

The idea in one line: **the LLM reads, the code decides.** The model extracts the facts with word-for-word quotes, plain code verifies the quotes and checks the numbers, and the model can say "yes" only if the code agrees.

Read **[DESIGN.md](DESIGN.md)** for the business process, research, architecture decisions, roadmap and an interview cheat-sheet.

| Part | Tech |
|---|---|
| `backend/` | NestJS 12, Prisma 7 + PostgreSQL, Zod, OpenAI SDK (Structured Outputs) |
| `frontend/` | React 19 (JSX), Vite 8 |

## Run it

You need **Node 22.12 or newer**: 22, 24 or 26 (Prisma 7 does not support the odd releases in between). Built and tested on Node 26.

### 1. A database (pick one)

- **With Docker:** `docker compose up -d` (from this folder). Postgres listens on `localhost:5432`.
- **Without Docker:** `cd backend && npx prisma dev --name claims --detach`. It prints a `postgres://…` URL; use it as `DATABASE_URL` in the next step.

### 2. The backend

```bash
cd backend
cp .env.example .env     # then edit .env, see "Choosing the model" below
npm install              # also generates the Prisma client
npm run db:deploy        # creates the tables
npm run start:dev        # API on http://localhost:3000/api
```

### 3. The frontend

```bash
cd frontend
npm install
npm run dev              # UI on http://localhost:5173
```

Open the UI, press one of the **example** buttons, then **Assess claim**.

### Choosing the model

In `backend/.env`:

- **Offline demo, no API key:** `LLM_PROVIDER=fake`. A small text-matching stand-in answers instead of a model. It even obeys "ignore all previous instructions" on purpose, so you can show the safeguard working (use the *Hidden instruction* example). Results mean nothing outside a demo.
- **Real OpenAI:** `LLM_PROVIDER=openai`, `OPENAI_API_KEY=sk-…`, and `OPENAI_MODEL=` any model that supports Structured Outputs. Delete the `OPENAI_TEMPERATURE` line for models that reject it (reasoning models). Study text is confidential, so use an enterprise or no-retention account.

The app refuses to start with a clear message if a required setting is missing, and it never falls back to the fake silently.

## Try the API directly

```bash
curl -s -X POST http://localhost:3000/api/claims/assess \
  -H 'content-type: application/json' \
  -d '{
    "claim":    { "text": "Reduces wrinkles by 20% in 4 weeks" },
    "evidence": { "text": "Study CS-2417. Randomised, double-blind, vehicle-controlled study. 45 women (n = 45). At week 4, wrinkle depth was reduced by 23% from baseline (p = 0.003)." }
  }' | jq
```

## Checks and tests

| Where | Command | What it covers |
|---|---|---|
| `backend/` | `npm test` | Unit tests: verification, rule checks, decision rules, config, prompt, OpenAI provider (stub client), fake provider, DTO, service |
| `backend/` | `npm run test:e2e` | Real HTTP, validation pipe and Postgres, with the fake model. **Needs the database from step 1.** Only adds rows, never deletes |
| `backend/` | `npm run typecheck`, `npm run lint`, `npm run build` | Types, lint, production build (`npm run start:prod` runs it) |
| `frontend/` | `npm test` | The API helper and the component (jsdom + Testing Library) |
| `frontend/` | `npm run lint`, `npm run build` | Lint and production build |

## Layout

```
DESIGN.md                      design doc, decision log, roadmap, interview cheat-sheet
docker-compose.yml             local Postgres
backend/
  prisma/schema.prisma         Claim and Assessment tables (+ migrations/)
  src/claims/assessment/       the pure logic: verify-facts, run-checks, decide, policy
  src/claims/                  controller, service, repository, request validation (Zod)
  src/llm/                     provider interface, OpenAI + fake providers, schema, prompt
  src/config/  src/prisma/     validated settings, database access
  test/                        end-to-end tests
frontend/
  src/api/assessClaim.js       fetch wrapper: timeout, cancellation, readable errors
  src/components/              ClaimAssessment (form) and AssessmentResult (answer)
```

## Good to know

- `npm install` in `backend/` runs `prisma generate`; the generated client in `backend/src/generated/` is not committed.
- npm 11 may print `install-scripts` warnings about some dependencies. They are harmless here: the steps above were run from a clean copy with those warnings showing and everything worked.
- In development Vite forwards `/api` to `localhost:3000`, so there is no CORS setup to do. For a deployed UI, set `CORS_ORIGIN` on the backend and `VITE_API_BASE_URL` when building the frontend.
- There is no login yet. Put the API behind your company SSO and add rate limiting before exposing it (see the roadmap in DESIGN.md).
