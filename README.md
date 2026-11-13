# Movie Memory

Sign in with Google, save your favorite movie, and get fun facts about it from OpenAI, cached
with correctness guarantees.

**Variant: A (Backend-Focused: caching and correctness).**
**Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind 4, Postgres, Prisma 6,
NextAuth (Google OAuth, database sessions), OpenAI API, Vitest.

## Setup

**Prerequisites:** Node.js ≥ 20.9, Postgres ≥ 14, a Google OAuth client, an OpenAI API key.

```bash
npm install                  # also runs `prisma generate`
cp .env.example .env         # fill in the values below
createdb movie_memory
createdb movie_memory_test   # only for tests
npm run db:migrate           # apply prisma/migrations (use `npm run db:deploy` in prod/CI)
npm run dev                  # http://localhost:3000
```

Open the app at exactly `NEXTAUTH_URL` (`http://localhost:3000`, not `127.0.0.1`), or the OAuth
state cookie won't match ("State cookie was missing").

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string |
| `TEST_DATABASE_URL` | tests | Separate database for `npm test` (tables are truncated; refused if equal to `DATABASE_URL`) |
| `NEXTAUTH_URL` | yes | Base URL, e.g. `http://localhost:3000` |
| `NEXTAUTH_SECRET` | yes | Cookie signing secret: `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | yes | Google OAuth Web client. Origin `http://localhost:3000`, redirect URI `http://localhost:3000/api/auth/callback/google` |
| `OPENAI_API_KEY` | yes | Server-only. A restricted key needs the `model.request` permission |
| `OPENAI_MODEL` | no | Defaults to `gpt-5.4-mini`; must support the Responses API `web_search` tool |

### Migrations and checks

Migrations live in `prisma/migrations` (a single `init` migration). Tests apply them to
`TEST_DATABASE_URL` automatically.

```bash
npm test            # 45 Vitest tests against a real Postgres test database
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
npm run build       # production build
```

## Architecture overview

```
src/app/page.tsx                 Landing page; sends signed-in users to onboarding or dashboard
src/app/onboarding/actions.ts    Server Action: re-check session → validate → save
src/app/dashboard/               Server-rendered profile + client FactCard (calls /api/fact)
src/app/api/fact/route.ts        GET /api/fact: session → fact service → HTTP status
src/lib/facts/fact-service.ts    ★ Cache window, generation lease, fallback (dependency-injected)
src/lib/openai.ts                Responses API + web search, timeout/retry bounds
src/lib/auth.ts                  NextAuth config, getSessionUserId / requireUser
src/lib/validation.ts            Zod schema for movie titles (server-side source of truth)
prisma/schema.prisma             Data model
tests/                           Service, route, server action, validation, OpenAI helper
```

**Flow.** Google sign-in returns to `/`, which routes by one rule: no favorite movie →
`/onboarding`, otherwise → `/dashboard`. Protected pages redirect to `/` when signed out. The
onboarding Server Action re-checks the session, validates the title (trimmed, 1–100 chars, no
control characters, must contain a letter or digit) and saves with
`updateMany({ where: { id, favoriteMovie: null } })`, so a replayed submit can't overwrite it.
The dashboard renders name, email, photo and movie on the server; the fact card fetches
`GET /api/fact` on the client so a slow OpenAI call never blocks the page.

**Data model.**

- `User`: NextAuth user plus `favoriteMovie String?` (`NULL` means onboarding isn't done).
  `Account` and `Session` are required by the Prisma adapter.
- `MovieFact`: append-only `(userId, movie, content, createdAt)`, indexed on
  `(userId, movie, createdAt DESC)`. **The cache is this table**: a cached fact is the newest
  row under 60s old, so there's no second store to keep consistent. Storing the `movie` title on
  each fact means a changed favorite automatically ignores old facts.
- `FactGenerationLock`: a "generation in progress" lease keyed by `(userId, movie)`, with
  `token` and `lockedUntil`.
- All timestamps are `timestamptz`, and user-owned rows are deleted with the user (cascade).

### Fact service (Variant A core)

```
getFactForUser(userId)
 ├─ no favorite movie                    → 409
 ├─ newest fact < 60s old                → "cache"
 ├─ acquire lease for (userId, movie)
 │   ├─ acquired: re-read cache (double-checked locking), then call OpenAI (20s deadline)
 │   │   ├─ success → insert fact        → "generated"
 │   │   └─ failure → previous fact?     → "stale" : 503
 │   │   finally: release the lease only if our token still holds it
 │   └─ held by another request
 │       ├─ previous fact exists         → return it now as "refreshing"
 │       └─ first-ever fact              → poll up to 30s → "cache" or 503
```

**1. 60-second cache.** Fresh means `now - createdAt < 60s`; exactly 60s regenerates. Tests
pin both 59.999s and 60.000s with a fake clock.

**2. Concurrency: a Postgres lease.**

- *Acquire:* `INSERT` the lock row. The composite primary key lets exactly one concurrent
  request win; the rest get a unique violation.
- *Crash recovery:* an expired lease is taken over with `UPDATE … WHERE lockedUntil < now`.
  Postgres re-checks the `WHERE` under the row lock, so only one racer succeeds.
- *Release:* `DELETE … WHERE token = mine`, so a slow holder can't delete someone else's lease.
- *Double-check after acquiring* prevents a second generation when another request finished
  between our cache read and our acquire.
- *Lease (30s) outlives the generation deadline (20s).* The service enforces the deadline
  itself (abort signal), because the SDK can honor a `Retry-After` of up to 60s.

Alternatives considered: an in-memory lock breaks with multiple instances or serverless;
holding a transaction or advisory lock across the OpenAI call ties up pooled connections for
seconds; a unique constraint per 60s bucket doesn't match a sliding window.

**3. Failure handling.** Each OpenAI attempt has a 15s timeout and one retry, inside the 20s
service deadline. Any failure (timeout, 4xx/5xx, empty reply, missing key) is logged
server-side and the user gets their last fact as `"stale"`, or a friendly 503 if there is none.
Error details never reach the client, and the lease is always released.

**4. Authorization.** The user id comes only from the server-side session; `/api/fact` takes
no parameters and every query filters by `userId`. Tests confirm a user never receives another
user's fact, even for the same movie while that user's fact is fresh.

**Other safeguards.** Secrets are read only in `server-only` modules. The movie title is
JSON-encoded and the prompt treats it as data; output is rendered as escaped text with citation
links stripped. `/api/fact` is `Cache-Control: private, no-store`.

### Verification

- **Automated:** 45 tests across the fact service, API route, fact card, onboarding action, validation and
  OpenAI output cleanup. They run on real Postgres because the guarantees depend on real
  unique violations and row locks. Deliberately breaking the cache comparison, the lock, the
  `userId` filter, the post-lock re-check or the token check each makes tests fail.
- **End to end** (production build, real Google OAuth and OpenAI): sign-in and onboarding in a
  browser; redirects, dashboard data, logout and session revocation checked over HTTP and in
  the database. Facts were accurate for a 2025 film (*KPop Demon Hunters*). Repeats under 60s
  were cached; after the window, 5 simultaneous requests made exactly one OpenAI call while the
  other four got the previous fact immediately. Real OpenAI errors produced `"stale"` or a clean
  503, and no locks were left behind.

## Why Variant A

I chose Variant A because I wanted to focus on backend reliability and correctness. It allowed me to explore how caching reduces unnecessary API calls, how concurrency protection prevents duplicate requests, and how the application handles failures without disrupting the user experience. These are practical challenges that come up when building reliable backend systems.

## Key tradeoffs

- **DB lease over a simpler lock:** a few extra queries on a cache miss (none on a hit), in
  exchange for correctness across instances and recovery after crashes.
- **Serve the previous fact during regeneration** instead of making concurrent requests wait.
  Faster; the fact card then polls and shows the new fact as soon as it is cached.
- **Polling (500ms) over `LISTEN/NOTIFY`** for first-fact waiters: simpler and stateless.
- **App clock for freshness and leases:** easy to fake in tests; assumes NTP-synced instances.
- **Append-only facts:** simple invariants and free history, but unbounded growth.
- **Database sessions over JWT:** one extra query per request, but revocable sessions.
- **Web search for facts:** accurate for films newer than the model's training data (models
  without it didn't recognise 2025 releases), at ~3–5s and a search fee per fresh fact, limited
  to one per user and movie per minute by the cache.

**Known limitations:** no global spend cap or per-user rate limit across movies; old facts and
abandoned lock rows aren't cleaned up; titles aren't checked against a movie database, and a
misleading web page could still produce a wrong fact; the Google consent screen is in Testing
mode, so only listed test users can sign in.

## What I'd improve with 2 more hours

- Let users edit their favorite movie (the data model already handles it).
- Prune old facts and expired lock rows on a schedule.
- Per-user rate limiting on cache misses to cap OpenAI spend.
- Pass recent facts to the prompt to avoid repeats.
- Structured logging and metrics: cache hit rate, OpenAI latency, fallback rate.
- Playwright tests for sign-in → onboarding → dashboard with a mocked OAuth provider.

## AI usage

- Used Claude Code to accelerate implementation of application features, including database integration, caching mechanisms, concurrency protection, and automated tests.
- Leveraged AI-assisted code reviews and debugging to identify bugs, evaluate edge cases, and improve error handling and application reliability.
- Used AI tools to compare OpenAI models and explore web search integration to improve the accuracy of movie-related facts.

## Manual Contributions
- Designed the application architecture and selected database structures, caching strategies, concurrency controls, and failure-handling mechanisms.
- Implemented and modified core application logic, incorporating AI-generated code where appropriate.
- Debugged application issues, traced root causes, and refined implementations to improve correctness and reliability.
- Designed and executed tests covering authentication, database operations, concurrency, and failure scenarios.
- Configured Google OAuth, created API credentials, and securely managed sensitive environment variables.


