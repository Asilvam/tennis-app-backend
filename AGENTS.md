# AGENTS.md

## Architecture At A Glance

- NestJS monolith with feature modules wired in `src/app.module.ts`; app bootstrap is `src/main.ts`.
- Global behavior in `src/main.ts`: `ValidationPipe({ transform: true })`, CORS `origin: '*'`, Swagger at `/docs`, health check at `/healthz`.
- Mongo is initialized in `src/database/database.module.ts` (`process.env.MONGODB_URI`, db `Tennis`).

## High-Value Domain Flows

- Registration: `POST /register` → `RegisterService.create()` hashes password, validates category rules, saves `register`, initializes `player_category_points`, sends verification email (`src/register/register.service.ts`).
- Reservation lifecycle: `CourtReserveService.create()` validates slot/date/player conflicts, saves reserve, logs audit, sends emails (`src/court-reserve/court-reserve.service.ts`).
- Ranking update: `POST /match-ranking` resolves active category per player/match type, updates `player_category_points`, sets `resultMatchUpdated` via `CourtReserveService.updateResultMatch()` (`src/match-ranking/match-ranking.service.ts`).
- Payment callback-like flow: `POST /court-reserve/emailconfirmation` logs payment audit and sends approved/rejected mail (`src/court-reserve/court-reserve.service.ts`).

## Module Boundaries To Keep

- `register` owns player identity/profile, payment/user state, and email verification token (`src/register/entities/register.entity.ts`).
- `player-category-points` owns category points persistence; `register` + `match-ranking` consume it (`src/player-category-points/*`).
- `court-reserve` owns booking integrity; `booking` only orchestrates admin bulk blocking via `adminReserve()` (`src/booking/booking.service.ts`).
- `audit-log` is cross-cutting for reserve create/cancel/state/payment/result events (`src/audit-log/audit-log.service.ts`).

## Category System (Critical Domain Rules)

- All category constants/enums live in `src/register/enums/category.enum.ts`: `Category`, `MatchType`, `MAIN_SINGLES_CATEGORIES`, `DOUBLES_CATEGORY`. Import from there, never hardcode strings.
- **One active main singles category per player**: a player can only have one active category among `1|2|3|4`. Enforced in:
  - `RegisterService._validateMainSinglesCategoryRuleOnCreate()` (at registration)
  - `PlayerCategoryPointsService` on `addCategoryToPlayer()`, `initializePlayerCategories()`, `updatePlayerPoints()` (at category management)
- **Segregated singles competition**: `1-4` only play each other; `+55` only vs `+55`; `+65` only vs `+65`. Never cross-group.
- **Doubles is a shared pool**: all players compete together in `Dobles` category regardless of their singles category.
- **Client sends only the relevant category** per player per match: singles payload carries exactly one non-Dobles active category; doubles payload carries `Dobles`. Server validates this and rejects ambiguous payloads.
- `MatchRankingService._resolveSinglesCategories()` validates and extracts the single non-Dobles active category sent by the client. Cross-group singles (e.g. cat 2 vs +55) are rejected.
- `MatchRankingService._resolveDoublesCategory()` enforces player has `Dobles` active before scoring doubles.

## Scoring Formulas

- **Singles 1-4 (same category)**: winner `+300`, loser `+50`; if winner had fewer points, transfers `floor(diff/5)` extra.
- **Singles 1-4 (different categories)**: winner is lower-ranked (`parseInt(cat)` higher) → `+600/+50`; winner is higher-ranked → `+150/+50`.
- **Singles special (+55, +65, etc.)**: fixed `+300/+50` regardless of points difference.
- **Doubles**: fixed `+300/+50` for all four players on their `Dobles` category.

## Codebase Conventions (Project-Specific)

- Keep direct `EmailService` injection pattern used by modules (`src/register/register.module.ts`, `src/court-reserve/court-reserve.module.ts`, `src/match-ranking/match-ranking.module.ts`).
- Prefer soft-state flags (`state`, `isActive`, `wasPaid`, `resultMatchUpdated`) over hard deletes in reservation/category flows.
- Preserve Chile time handling with Luxon (`America/Santiago`) in reservation/time validation logic.
- Follow DTO + class-validator boundaries for controllers (see `src/register/dto/create-register.dto.ts`).
- Keep bilingual (mostly Spanish) API texts/messages consistent with nearby code.
- Category resolution logs: `MatchRankingService` logs `{ categoryResolved, winner, looser }` per match for traceability.

## Known Drift / Footguns

- Scripts/docs call `/register/:email/categories`, but that route is absent in `src/register/register.controller.ts`.
- `test-complete-system.sh` payloads for `POST /match-ranking` still use old `category` flat field — update to send `categories[]`.
- `MatchRankingService.getRanking()` groups by category only, while `test-ranking-format.sh` expects `{categoria}-{matchType}` keys.

## Workflows That Help Immediately

- Install/build/run: `npm install`, `npm run build`, `npm run start:dev` (see `package.json`).
- Quick API sanity: run `test-complete-system.sh`, `test-category-management.sh`, `test-ranking-format.sh` with server up.
- Prefer `/docs` Swagger for current routes; several markdown docs/scripts are stale.
- Debug fastest by tracing controller → service → Mongoose model updates and checking `Logger` output.

## External Integrations / Env Keys

- Auth/JWT: `SECRET_KEY`, `TOKEN_EXPIRE_TIME` (`src/auth/*`).
- MongoDB: `MONGODB_URI` (`src/database/database.module.ts`).
- Email microservice proxy: `EMAIL_SERVICE_API_URL` (`src/email/email.service.ts`).
- Cloudinary: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (`src/cloudinary/cloudinary.service.ts`).
- Mercado Pago proxy: `MP_API_URL` (`src/mp/mp.service.ts`).
- Web push: `MAIL_USER`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (`src/notification/notification.service.ts`).
