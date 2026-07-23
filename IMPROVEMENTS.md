# Codebase Analysis & Roadmap

> **Status:** Draft · **Type:** Tech Debt / Architecture Epic
> **Scope:** `frontend/`, `backend/`
> **Owner:** Alin

This document tracks the higher-level architectural improvements we want to make to the
codebase. These are not blocking bugs — the app works today — but they represent debt that
will slow us down (and get riskier) as the product grows, particularly once we start
enriching large volumes of leads.

---

## 1. `LeadsList.tsx` is a god component

**Where:** `frontend/src/components/LeadsList.tsx` (~334 lines)

**Problem**

`LeadsList` has quietly become a dumping ground. In a single component it currently owns:

- **Data fetching** — the `leads.getMany` query is declared inline.
- **Multiple mutations** — `deleteLeadsMutation` and `verifyEmailsMutation` (with their own
  `onSuccess`/`onError`/toast/`invalidateQueries` logic) live directly in the component body.
- **Selection state** — `selectedLeads`, select-all / indeterminate logic, per-row toggling.
- **UI chrome state** — `isMessageModalOpen`, `isEnrichDropdownOpen`, `isImportModalOpen`.
- **Presentation** — the toolbar, the enrich dropdown, the full table, loading/error/empty
  states, and inline helpers like `formatDate` are all rendered from here.

The result is that any change — a new column, a new enrich action, a tweak to selection — means
editing one large file where fetching, mutations, state, and markup are all interleaved. It's
hard to read, hard to test in isolation, and prone to merge conflicts as more people touch it.

**Proposed direction**

Split it along its natural seams. A rough shape:

- **Data/logic → hooks:** move the query and mutations into dedicated hooks
  (`useLeads`, `useDeleteLeads`, `useVerifyEmails`) so data concerns are reusable and unit-testable.
- **Selection → hook:** extract `useLeadSelection` to own `selectedLeads` and the
  select-all/indeterminate derivations.
- **Presentation → smaller components:** `LeadsToolbar`, `EnrichMenu`, `LeadsTable` /
  `LeadRow`, and shared `Loading` / `ErrorState` / `EmptyState` components.
- `LeadsList` then becomes a thin container that wires these together.

**Benefit:** each piece can be tested and changed independently; the container stays readable;
new enrich actions become "add a menu item + a hook" rather than "edit the 334-line file."

---

## 2. Do the real work in Temporal workers, not in the request handlers

**Where:** `backend/src/index.ts` — `/leads/verify-emails`, `/leads/generate-messages`,
`/leads/bulk`

**Problem**

Right now our long-running / fan-out work happens synchronously inside the HTTP handlers:

- `/leads/verify-emails` loops over every selected lead and `await`s
  `client.workflow.execute(...)` **one at a time**, inside the request. Even though a Temporal
  workflow is involved, the endpoint blocks until every workflow finishes before responding.
- `/leads/generate-messages` and `/leads/bulk` don't touch Temporal at all — they loop and hit
  Prisma per record inside the request.

This is risky:

- **Timeouts.** A large selection means a long request. The user's browser, a load balancer, or
  a reverse proxy will eventually cut the connection, and the client has no idea how far the work
  got.
- **Blocking UX.** The user is stuck waiting on a spinner for something that should be
  fire-and-forget.
- **No durability / retries.** If the process crashes halfway through a 5,000-lead enrichment,
  that work is simply lost — the whole point of Temporal (durable execution, retries, visibility)
  is being bypassed.

**Proposed direction**

Treat the API as a thin dispatcher and let Temporal own the work:

- The endpoint should **start** a workflow (e.g. a `bulkVerifyEmailsWorkflow` /
  `bulkGenerateMessagesWorkflow`) and return immediately — ideally `202 Accepted` with a job/
  workflow id — instead of awaiting completion.
- Move the per-lead loop **into the workflow**, fanning out to activities (with proper
  `startToCloseTimeout`, retries, and heartbeating for long activities) rather than looping in
  Express.
- The frontend polls the job status (or subscribes) and updates the row state as results land.
- Apply the same pattern to CSV bulk import and message generation so all bulk operations are
  consistent and safe at volume.

**Benefit:** requests stay fast and reliable, work survives restarts, and we get retries +
observability for free — which matters a lot the moment "enrich" means thousands of leads.

---

## 3. Backend architecture: thin the route handlers, add layer boundaries

**Where:** `backend/src/index.ts` (single ~324-line file with all routes)

**Problem**

Every route handler in `index.ts` does everything itself: request parsing, ad-hoc validation,
business logic, direct Prisma calls, Temporal client setup, and response shaping — all inline.
For example `/leads/bulk` handles validation, dedup-key building, duplicate lookup, per-record
creation, and error aggregation in one block. There's no separation of concerns, logic isn't
reusable across endpoints, and there's very little TypeScript coverage of the shape of
`req.body` (it's mostly `any` with hand-rolled `if` checks and `String(...)` coercions).

**Proposed direction**

Introduce clear layers with typed boundaries between them:

- **Routing/controllers** — parse the request, call a service, shape the response. Nothing else.
- **Validation** — validate/parse input at the edge with a schema library (e.g. **Zod**), so the
  handler receives a fully-typed, trusted object instead of raw `any`.
- **Services** — the business logic (dedup rules, message generation orchestration, enrichment
  dispatch), independent of Express and unit-testable.
- **Data access** — keep Prisma usage behind a repository/data layer so services aren't coupled
  to query details.
- Split routes into modules (e.g. `routes/leads.ts`) instead of one monolithic file, and share a
  single Prisma / Temporal client rather than re-creating connections per request (see the
  `Connection.connect(...)` inside `/leads/verify-emails`).

**Benefit:** handlers become trivial, logic is reusable and testable, and strong typing between
layers catches mistakes at compile time instead of at runtime.

---

## 4. End-to-end type safety between frontend and backend

**Where:** `frontend/src/api/types/leads/*` vs `backend/src/index.ts`

**Problem**

The frontend already has a nice typed API client (`frontend/src/api/modules/leads.ts` with
`Input`/`Output` DTOs per endpoint). But those types are **hand-maintained on the frontend and
completely disconnected from the backend.** `LeadsGetManyOutput` is a manually written mirror of
what Prisma returns; the backend has no compile-time knowledge of these shapes at all. If someone
changes a response field, renames a column, or tweaks a request body on the backend, nothing
breaks until it fails at runtime in the browser. The two sides can drift silently.

**Proposed direction**

Establish a single source of truth for request/response contracts. Options, roughly in order of
effort:

1. **Shared types package** — a workspace package (e.g. `packages/shared` in a pnpm workspace —
   we already have `pnpm-workspace.yaml` files lying around) exporting the DTOs, imported by
   *both* frontend and backend. The backend handlers are typed against the same contracts the
   frontend consumes. Pairs naturally with **Zod schemas** so the runtime validator and the
   static type are derived from one definition.
2. **Infer types from the backend** — a typed RPC layer (tRPC) or an OpenAPI spec generated from
   the backend with a generated client, so the frontend types are *derived* rather than
   duplicated.

Whichever we pick, the goal is the same: a change to an endpoint's input/output should produce a
**compile error** on the other side, not a runtime surprise.

**Benefit:** refactors become safe, the manual DTO duplication disappears, and the client/server
contract is enforced by the type checker.

---

## Suggested sequencing

1. **#4 (shared types)** first — it's the foundation the other work benefits from and unblocks
   safe backend refactoring.
2. **#3 (backend layering + validation)** — naturally lands alongside #4.
3. **#2 (Temporal offloading)** — build on the cleaned-up service layer.
4. **#1 (`LeadsList` split)** — can proceed in parallel; independent of the backend work.
