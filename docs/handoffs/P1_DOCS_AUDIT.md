# P1-15 contract audit

Date: 2026-10-27. Scope: all existing backend source, frontend auth/API usage,
API_SPEC, DATABASE_SCHEMA, .env.example, README, Compose and setup instructions.
No application logic outside `backend/src/scripts/seed.js` was changed.

## Mismatches corrected in documentation

| Contract mismatch | Resolution |
| --- | --- |
| API_SPEC presents future endpoints alongside working endpoints without implementation status. | Mark Challenges, Instances, Leaderboard and Admin as unimplemented Phase 2/3 contracts; currently 404. |
| Global auth statement implies unknown paths require a token. | Clarify protected routes authenticate individually; unknown routes return 404. |
| Identity section only describes persistence through `/me`. | Document create/join also upsert users and refresh token fields; team read/leave do not. |
| `player` guard semantics could imply an admin can use player team routes. | Document exact-role matching and current admin 403 behavior. |
| Validation “details” is ambiguous. | Document details in `error.message`, with no extra response property. |
| DATABASE_SCHEMA presents all six models as current. | Mark only User and Team as implemented; preserve future contracts. |
| User role described as updated “on each login”. | Specify actual writes: GET/PATCH `/me`, team create/join. Cognito login alone does not update MongoDB. |
| Required fields, ref names/defaults and User/Team `__v` omitted. | Record actual Mongoose schema behavior and collection mappings. |
| Invite code described only as uppercase characters. | Record exact six-character alphabet and required/unique constraints. |
| Team name bounds, trim and exact collation omitted. | Record 3-24 characters, trim, locale en/strength 2. |
| User display-name/email and Team membership invariants could be read as schema validators. | Distinguish PATCH/token validation and transactional route invariants from schema validation. |
| `.env.example` local URI suggests standalone MongoDB works for all Phase 1 features. | Explain Atlas/replica-set requirement, per-developer Network Access and container localhost behavior. |
| Environment template did not explain Vite build-time values or currently required future variables. | Add comments; all 18 validated application variables were already present, no missing variable found. |
| README says no frontend/teams exist and seed is a reminder. | Replace stale status and document seed behavior and current frontend run commands. |
| SETUP omits SRP, build prerequisite, per-developer Atlas IPs, and claims challenge network is created now. | Clarify setup and current Phase 2 boundary. |

## Code concerns reported, not repaired

- Resolved: Compose now mounts `frontend/dist` and Nginx has an SPA fallback.
  The fresh-clone gate still needs a Docker run to confirm.
- Backend `COGNITO_REGION` is required but not cross-validated against the pool;
  verifier configuration uses pool ID and client ID. Frontend checks its pool
  prefix. TASKS records a previous local region mismatch; private settings were
  not read or modified in this session. Human must verify both configurations.
- Team model permits empty/duplicate member IDs or a captain outside the member
  list if written directly; normal routes preserve these invariants. Do not let
  future services assume the schema alone enforces membership consistency.
- User model permits arbitrary display-name lengths; GET defaults may fall
  outside PATCH bounds. Confirm intended policy with Swarup before any change.
- Exact-role guards deny admins access to current player-only team routes.
  This matches current guards; confirm if a future admin-as-player flow is wanted.

## Boundaries and validation

No endpoint, model or scoring rule was changed. No dependencies added. No cloud
configuration, credentials, real account IDs or connection strings were read
for this audit. Automated checks and human-only gate items are recorded in the
handoff. Future endpoint/model absence is planned work, not a Phase 1 bug.
