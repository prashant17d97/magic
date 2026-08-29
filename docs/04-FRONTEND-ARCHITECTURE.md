# MAGIC — Frontend Architecture

**Next.js 16 (App Router) · React 19.2 · TypeScript 5 strict · Version 1.0**

---

## 1. Stack

Versions verified as of August 2026.

| Concern | Choice | Version | Rationale |
|---|---|---|---|
| Framework | Next.js | 16.2.x (Active LTS) | App Router is default; Server Components let the heavy table shell render server-side. Note: 16.x has had a heavy security-advisory cadence — pin to the current LTS patch and subscribe to advisories |
| React | React | 19.2 | View Transitions, `useEffectEvent`, Activity |
| Bundler | Turbopack | default in 16 | |
| Styling | Tailwind CSS | 4.x | Token-driven via CSS custom properties (see `05-DESIGN-SYSTEM.md`) |
| Components | shadcn/ui on Base UI | current | Unstyled, accessible primitives we own the source of — critical for a design system with a custom palette |
| Server state | TanStack Query | 5.x | Client-side cache for the interactive table; SSR hands off the first page |
| UI state | Zustand | 5.x | Density, column config, drawer state, command palette |
| URL state | `nuqs` | current | Filters, sort, cursor, selected row — must survive refresh and be shareable |
| Tables | TanStack Table | 8.x | Headless; we own the markup, which we must for density and a11y |
| Charts | Recharts | current | Modest needs — sparklines and a couple of trend lines |
| Forms | React Hook Form + Zod | current | Shared Zod contracts with the backend |
| Testing | Vitest + Testing Library + MSW 2 + Playwright | current | |

**Middleware note:** Next.js 16 renames `middleware.ts` to `proxy.ts`. Auth gating lives there, and given the number of middleware-bypass advisories in the 16.x line, session checks are re-validated in the route handler as well — never in the proxy alone.

---

## 2. The BFF Boundary

```
Browser ──HttpOnly session cookie──► Next.js (web)
                                         │  service token, internal network
                                         ▼
                                   NestJS (api)
```

The NestJS API is never exposed publicly. Next.js route handlers are the only path in.

This buys three things:

1. **No access token in the browser.** Nothing to steal via XSS. The session cookie is `HttpOnly`, `Secure`, `SameSite=Lax`, and the CSRF double-submit token guards mutations.
2. **Server Components can query directly.** The exception queue's first page renders on the server with no client waterfall.
3. **One place to enforce scope.** The route handler attaches the caller's tenant and account scope from the session; the browser cannot influence either.

```ts
// app/api/exceptions/route.ts
export async function GET(req: NextRequest) {
  const session = await requireSession();          // throws 401
  const params  = ExceptionQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams),  // validate at the boundary
  );
  // tenant + scope come from the session, NEVER from the request
  return proxyToApi('/v1/exceptions', {
    ...params,
    tenantId: session.tenantId,
    scope: session.accountScope,
  });
}
```

---

## 3. Folder Structure

Feature-sliced. Tests co-located with the code they test.

```
apps/web/src/
├── app/
│   ├── layout.tsx                    # ThemeProvider, fonts, providers
│   ├── proxy.ts                      # Next 16 middleware — auth gate
│   ├── (auth)/
│   │   ├── sign-in/page.tsx
│   │   └── select-tenant/page.tsx
│   ├── (console)/
│   │   ├── layout.tsx                # sidebar shell, command palette, tenant switcher
│   │   ├── page.tsx                  # health overview
│   │   ├── exceptions/
│   │   │   ├── page.tsx              # owns: filters (URL), selection, drawer
│   │   │   └── [id]/page.tsx         # deep-linkable detail
│   │   ├── runs/[[...id]]/page.tsx
│   │   ├── settlements/page.tsx
│   │   ├── accounts/[[...id]]/page.tsx
│   │   ├── exports/page.tsx
│   │   ├── audit/page.tsx
│   │   └── settings/{rules,members,connections}/page.tsx
│   └── api/                          # BFF route handlers
│
├── features/
│   ├── exceptions/
│   │   ├── components/
│   │   │   ├── ExceptionTable.tsx           + .test.tsx
│   │   │   ├── ExceptionRow.tsx             + .test.tsx
│   │   │   ├── ExceptionDetailPanel.tsx     + .test.tsx
│   │   │   ├── EvidenceDiff.tsx             + .test.tsx
│   │   │   ├── RuleTrace.tsx
│   │   │   ├── SeverityBadge.tsx
│   │   │   └── ResolutionForm.tsx
│   │   ├── hooks/
│   │   │   ├── useExceptions.ts             + .test.ts
│   │   │   ├── useExceptionTransition.ts    + .test.ts
│   │   │   └── useQueueKeyboard.ts          + .test.ts
│   │   ├── services/exceptionsService.ts    + .test.ts
│   │   ├── store/queueStore.ts              + .test.ts
│   │   ├── types.ts
│   │   └── index.ts                         # the ONLY public surface
│   ├── health/ · runs/ · settlements/ · accounts/ · exports/
│   ├── rules/ · members/ · audit/
│
├── shared/
│   ├── components/
│   │   ├── ui/                       # Button, Badge, Dialog, Drawer, Select…
│   │   ├── data/                     # DataTable, ColumnPicker, DensityToggle,
│   │   │                             # CursorPager, SavedViews, FilterBar
│   │   ├── money/                    # Amount, AmountDelta, CurrencyCell
│   │   └── feedback/                 # EmptyState, ErrorState, Skeleton, Toast
│   ├── hooks/                        # useDebounce, useHotkeys, useDisclosure
│   └── lib/
│       ├── apiClient.ts
│       ├── queryClient.ts
│       ├── money.ts                  # BigInt-safe formatting
│       └── cn.ts
│
├── providers/AppProviders.tsx
├── styles/{tokens.css, globals.css}
└── test/
    ├── setup.ts
    ├── msw/{handlers.ts, server.ts}
    └── utils/{renderWithProviders.tsx, factories.ts}
```

### Cross-feature imports are forbidden

```ts
import { ExceptionTable } from '@/features/exceptions';                     // ✅
import { ExceptionTable } from '@/features/exceptions/components/…';        // ❌
import { RunBadge }       from '@/features/runs/components/RunBadge';       // ❌
```

If two features need the same component, it moves to `shared/`. Enforced by ESLint `no-restricted-imports`, checked in CI.

---

## 4. State Ownership

```
app/(console)/exceptions/page.tsx      ← OWNS
  ├─ filters, sort, cursor            → URL (nuqs)
  ├─ selected exception id            → URL (deep-linkable)
  └─ drawer open/closed               → derived from selected id
       │
       ├─ <FilterBar/>                 props in, callbacks out
       ├─ <ExceptionTable/>            OWNS row hover, column resize only
       │    └─ <ExceptionRow/>         OWNS nothing
       └─ <ExceptionDetailPanel/>      OWNS its own form draft state
```

### Decision table

| State | Home | Why |
|---|---|---|
| Exception list data | TanStack Query | Server state — cached, deduped, background-refetched |
| Filters, sort, cursor | URL via `nuqs` | Survives refresh; an operator can paste a link into Slack and a colleague sees the same queue |
| Selected exception | URL | Deep-linkable — `/exceptions/abc123` is a shareable reference to a specific finding |
| Column config, density, theme | Zustand + server-persisted preference | Personal, durable, not URL-worthy |
| Command palette open | Zustand | Ephemeral global UI |
| Resolution form draft | `useState` in the panel | Local; discarded on close |
| Row hover | CSS `:hover` | Not state at all — this is the mistake that makes tables sluggish |

**Never in Zustand:** server data. Never in URL: anything a user wouldn't want in a shared link.

---

## 5. Data Fetching

Server-render the first page; hydrate into the client cache for interaction.

```tsx
// app/(console)/exceptions/page.tsx  — Server Component
export default async function ExceptionsPage({ searchParams }) {
  const params = ExceptionQuerySchema.parse(await searchParams);
  const qc = new QueryClient();

  await qc.prefetchQuery({
    queryKey: exceptionKeys.list(params),
    queryFn: () => exceptionsService.list(params),
  });

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <ExceptionQueueContainer initialParams={params} />
    </HydrationBoundary>
  );
}
```

The operator sees rows in the first paint. Subsequent filter changes are client-side and instant.

### Query key factory

Mandatory for every feature with server state. Ad-hoc key strings are how cache invalidation bugs start.

```ts
export const exceptionKeys = {
  all:     ['exceptions'] as const,
  lists:   ()                    => [...exceptionKeys.all, 'list'] as const,
  list:    (p: ExceptionQuery)   => [...exceptionKeys.lists(), p] as const,
  details: ()                    => [...exceptionKeys.all, 'detail'] as const,
  detail:  (id: string)          => [...exceptionKeys.details(), id] as const,
  counts:  (p: CountQuery)       => [...exceptionKeys.all, 'counts', p] as const,
};
```

### Query client defaults

```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,          // financial data — modest staleness only
      gcTime: 5 * 60_000,
      retry: 2,
      retryDelay: a => Math.min(1000 * 2 ** a, 30_000),
      refetchOnWindowFocus: true, // an operator returning to the tab wants current state
      placeholderData: keepPreviousData,  // no flash on pagination
    },
  },
});
```

`refetchOnWindowFocus` is on here, unlike most apps. An operator alt-tabs to Stripe, resolves something, comes back — stale data at that moment causes a wrong decision.

### No optimistic updates on money

Optimistic UI is right for a "like" button and wrong for `resolve exception`. The mutation shows a pending state and waits for the server. If it fails, nothing was ever misrepresented as done. In a system whose entire premise is accuracy, showing a state that might not be true undermines the product.

---

## 6. The Data Table

The exception queue is the product. It must stay fast at 50 rows/page with heavy filtering and fluid keyboard navigation.

| Concern | Approach |
|---|---|
| Pagination | Cursor-based. `OFFSET` is never used, at any layer |
| Virtualisation | Not in v1 at 50 rows/page. `@tanstack/react-virtual` behind a flag if page size grows |
| Row re-renders | Row memoised on `(id, status, assignee, lastSeenAt)`. Hover is CSS-only |
| Column resize | CSS Grid `grid-template-columns` on the container — no per-cell JS |
| Selection | `Set<string>` in Zustand; rows read a boolean via a narrow selector, not the whole set |
| Sticky header | `position: sticky` — no scroll listener |
| Numeric columns | `font-variant-numeric: tabular-nums`, right-aligned |
| Loading | Skeleton rows matching final row height exactly — zero layout shift |

### Keyboard model

An operator working a queue should rarely touch the mouse.

| Key | Action |
|---|---|
| `j` / `k` | Next / previous row |
| `Enter` / `o` | Open detail |
| `Esc` | Close detail |
| `e` | Resolve (opens note field, focused) |
| `i` | Ignore (opens note field, focused) |
| `a` | Assign |
| `x` | Toggle row selection |
| `/` | Focus search |
| `⌘K` | Command palette |
| `g` then `h`/`e`/`r` | Go to health / exceptions / runs |
| `?` | Shortcut reference |

Every shortcut has a visible equivalent. Shortcuts accelerate; they never gate.

---

## 7. Money Formatting

```ts
// shared/lib/money.ts
// Amounts arrive as STRINGS. BIGINT exceeds Number.MAX_SAFE_INTEGER and
// JSON numbers are doubles — parsing to Number is a silent corruption bug.
export function formatMinor(
  amountMinor: string,
  currency: string,
  locale = 'en-US',
): string {
  const exponent = CURRENCY_EXPONENTS[currency] ?? 2;   // JPY = 0, KWD = 3
  const negative = amountMinor.startsWith('-');
  const digits   = (negative ? amountMinor.slice(1) : amountMinor).padStart(exponent + 1, '0');
  const whole    = digits.slice(0, digits.length - exponent) || '0';
  const frac     = exponent ? digits.slice(-exponent) : '';

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(Number(`${negative ? '-' : ''}${whole}.${frac || '0'}`));
}
```

Three rules for every money-bearing surface:

1. Amounts never round-trip through `Number` before formatting.
2. Currency is always displayed. A bare `1,250.00` in a multi-currency tool is a defect.
3. Deltas carry an explicit sign and a directional label — `−$412.50 (short)` beats a red number the reader has to interpret.

---

## 8. Performance Budget

| Metric | Target | Enforcement |
|---|---|---|
| LCP (exception queue) | < 1.5 s p75 | Lighthouse CI |
| INP | < 200 ms p75 | RUM |
| CLS | < 0.05 | Skeletons match final dimensions |
| Initial JS (console route) | < 180 KB gzip | `size-limit` in CI, fails the build |
| Table filter interaction | < 100 ms | React Profiler assertion in a perf test |

Techniques applied: Server Components for static shell; `next/dynamic` for the charts bundle and command palette; `next/font` with `display: swap` and subsetting; route-level code splitting by default in App Router.

---

## 9. Error and Empty States

Three distinct states, never conflated:

```tsx
// No data because nothing is wrong — the GOOD outcome in this product
<EmptyState
  variant="all-clear"
  title="No open exceptions"
  body="Every payout in the selected range reconciles. Last run 4 minutes ago."
  action={<Button variant="ghost">View reconciliation runs</Button>}
/>

// No data because the filters exclude everything
<EmptyState
  variant="no-results"
  title="No exceptions match these filters"
  body="Try widening the date range or clearing the severity filter."
  action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>}
/>

// Data could not be loaded
<ErrorState
  title="Couldn't load exceptions"
  body="The request failed. Your data is unaffected."
  traceId={error.traceId}
  action={<Button onClick={retry}>Retry</Button>}
/>
```

The all-clear state is the one worth designing carefully. In most products an empty table is a failure; here it is success, and it should read as reassurance rather than absence. It still states *when* it was last verified — "nothing is wrong" is only credible with a timestamp attached.

Error states surface `traceId`. It costs nothing and turns a support ticket from "it broke" into a one-query investigation.

---

## 10. Accessibility

| Requirement | Implementation |
|---|---|
| Keyboard operability | Every action reachable without a pointer; visible focus ring, 2px offset |
| Focus management | Detail drawer traps focus; returns to the originating row on close |
| Screen reader — table | Real `<table>` semantics, `scope` on headers, `aria-sort` on sortable columns |
| Screen reader — updates | `aria-live="polite"` on result counts and toasts |
| Colour independence | Severity always carries an icon and a text label, never colour alone |
| Contrast | AA verified per token pair in both themes (see design system) |
| Reduced motion | `prefers-reduced-motion` guard on every transition |
| Zoom | Usable at 200% without horizontal scroll on the primary column set |

---

## 11. Testing

| Priority | Layer | Tool | Coverage gate |
|---|---|---|---|
| 1 | `services/` | Vitest + MSW | 90% |
| 2 | `store/` | Vitest | 90% |
| 3 | `hooks/` | Vitest + `renderHook` | 80% |
| 4 | `components/` | Testing Library + `user-event` | 70% |
| 5 | E2E flows | Playwright | Critical paths only |

Playwright covers four journeys: sign in and select tenant; filter the queue and resolve an exception; drill from a payout checksum failure to its balance transactions; request an export and download it.

```bash
pnpm test
pnpm test:coverage
pnpm test:e2e
```

Every produced source file ships with its test file in the same commit. No exceptions — a service without a test is not done.
