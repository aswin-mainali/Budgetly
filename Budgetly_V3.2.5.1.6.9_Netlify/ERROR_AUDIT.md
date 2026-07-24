# Budgetly — Codebase Error Audit

_Audit date: 2026-07-24 · Branch: `claude/app-error-audit-7zan9l`_

> **STATUS: RESOLVED (2026-07-24).** All 38 TypeScript errors are fixed and every
> functional bug below has been addressed. `npx tsc --noEmit` is now **clean (0 errors)**
> and `npm run build` still passes. Each finding is annotated with **✅ Fixed** and how.
> Two items (C3, C5) were **intentionally deferred** — see their notes for why.

Findings are ordered by real-world impact. The production build (`npm run build`)
**succeeded even before the fixes** — Vite/esbuild strips types without checking them —
so none of these blocked deployment, but several were genuine runtime/logic bugs that
shipped silently.

Baseline (before fixes):
- `npm run build` → ✅ passed (8.6s)
- `npx tsc --noEmit` → ❌ **38 type errors across 6 files**
- `npm audit` → 2 vulnerabilities (1 moderate, 1 high) in dev-only tooling

After fixes:
- `npm run build` → ✅ passes
- `npx tsc --noEmit` → ✅ **0 errors**
- Netlify functions typecheck cleanly against the now-declared `@netlify/functions` types

---

## A. Real functional bugs (behavior is wrong at runtime)

### A1. Reports view never shows recurring data — always empty
- **File:** `src/components/AppViews.tsx:4875`
- `ReportsView` destructures `recurring` from `budget`, but the `useBudgetApp` hook
  exposes recurring items as **`sortedRecurring`**, not `recurring`. So `recurring` is
  `undefined`, `safeRecurring = Array.isArray(recurring) ? recurring : []` is **always `[]`**,
  and `recurringCount` (line 5004) is always `0`.
- **Effect:** the recurring section/count in Reports is permanently blank regardless of
  the user's actual recurring items.
- tsc: `Property 'recurring' does not exist on type '{...}'`.
- **✅ Fixed:** destructure `sortedRecurring` (same array `RecurringView` already uses) and
  feed it into `safeRecurring`. All downstream logic unchanged.

### A2. PWA install banner's "Dismiss" button does nothing
- **File:** `src/components/pwa/PwaInstallPrompt.tsx:4,12`
- Destructures `dismiss` from `usePwaInstall()`, but the hook (`src/hooks/usePwaInstall.ts:70`)
  never returns a `dismiss` function. `onClick={dismiss}` binds `undefined`.
- **Mitigating factor:** `PwaInstallPrompt` is **not rendered anywhere** (only `Auth.tsx`
  uses the hook, and it uses the correct fields). So this is a broken/dead component today,
  but it will misbehave the moment someone mounts it.
- tsc: `Property 'dismiss' does not exist`.
- **✅ Fixed:** added a `dismiss` callback to `usePwaInstall` (clears `promptEvent`) and
  returned it. The banner's Dismiss button now works if the component is ever mounted;
  `Auth.tsx` is unaffected.

### A3. Recurring "emoji" always falls back to the generic icon
- **File:** `src/components/AppViews.tsx:6076`
- The AI-assistant reply builds `` `${item.emoji ?? '🔁'} ${item.name}` `` but `RecurringItem`
  has no `emoji` field, so it's always `undefined` and every item shows `🔁`.
- **Effect:** cosmetic — the intended per-item emoji never appears. Guarded by `?? '🔁'`, so no crash.
- **✅ Fixed:** use `item.category?.emoji ?? '🔁'` (the item's category emoji), matching the
  identical pattern already used in `ReportsView` line 4988.

### A4. Investment `logoUrl` fallback is dead code
- **File:** `src/components/InvestmentsView.tsx:43,190,192,213,215`
- Code reads/writes `sec.logoUrl` / `selected.logoUrl`, but `SecuritySuggestion`
  (`src/services/marketData.ts:3`) only defines `logo_url`. All accesses are inside
  `logo_url || logoUrl` fallbacks, so functionally they resolve to `logo_url` and the
  `logoUrl` branch is unreachable.
- **Effect:** no visible bug today (correct field wins), but the fallback is a no-op and
  the `{...sel, logoUrl}` write (line 190) adds a phantom property. Likely a snake_case/
  camelCase mixup left over from a refactor.
- tsc: `Property 'logoUrl' does not exist ... Did you mean 'logo_url'?`
- **✅ Fixed:** removed every dead `logoUrl` property read/write; the code now uses
  `logo_url` consistently. `HoldingLogo`'s JSX prop is legitimately named `logoUrl` and was
  left as-is (it now receives `sec.logo_url`). Also wrapped the `openEdit` logo value in
  `|| undefined` so it matches the optional `string` type.
- **Note (`modalRows` `never`):** unifying the two `modalRows` branches under the existing
  `ModalSecurityRow` type surfaced a separate pre-existing quirk — inside the `!selected`
  picker branch TypeScript narrows `selected` to `never`, so `selected?.symbol` errored.
  Cast to `(selected as SecuritySuggestion | null)?.symbol` at that one read; runtime is
  unchanged (nothing is selected in that branch, so the comparison is always `false`).

---

## B. Type errors that are currently harmless but fragile

> **All of section B is ✅ Fixed.** Per-item resolutions below; none changed runtime behavior.

### B1. `view` state union includes `'utilities_hub'` that Sidebar can't accept
- **File:** `src/App.tsx:65,792`
- `view` is typed `ViewKey | 'utilities_hub'` and passed to `<Sidebar view={view}>`,
  which only accepts `ViewKey`. Nothing ever actually sets `view` to `'utilities_hub'`
  (only a dead comparison at line 378 references it), so it's a stale union member.
- **Effect:** none at runtime; type inconsistency that could hide a real navigation bug later.
- **✅ Fixed:** `'utilities_hub'` IS actually a live view (mobile Utilities nav sets it), so
  the right fix was to widen `Sidebar`'s `view` prop to `ViewKey | 'utilities_hub'`. Its
  internal comparisons still work.

### B2. PDF/CSV export color helpers reject valid colors (13 errors)
- **File:** `src/components/AppViews.tsx:378,385,401,418,476,477,503,535,586,639,662,976`
- The `divider(...)` and `panel(...)` helpers (lines 356/365) default their color params
  to `colors.border` / `colors.panel`, so TypeScript infers the param type as that specific
  literal string (e.g. `'#d9e1ef'`). Passing any other hex (`'#e5ebf5'`, `'#edf9f4'`, …) is a
  type error.
- **Effect:** none at runtime — every color string works. Pure type noise; fixable by
  widening the param types to `string`.
- **✅ Fixed:** widened the `color`/`fill`/`stroke` params of the `divider`, `panel`, and
  `line` canvas helpers to `string` (explicit annotation alongside the existing defaults).

### B3. `replaceAll` flagged by ES2020 lib target
- **File:** `src/components/AppViews.tsx:7392,7396,8918,8921`
- `tsconfig.json` `target`/`lib` is `ES2020`, which predates `String.prototype.replaceAll`
  (ES2021). Runtime is fine in all current browsers; the `char` callback params also fall to
  `implicitly any` because of the same error cascade.
- **Effect:** none at runtime on modern browsers. Bump `lib` to `ES2021` to clear it.
- **✅ Fixed:** bumped `tsconfig.json` `target` and `lib` from `ES2020` to `ES2021`. This
  also cleared the cascading `implicitly any` on the `char` callback params.

### B4. Legacy `matchMedia.addListener/removeListener` typed as `never`
- **Files:** `src/App.tsx:156-157`, `src/components/AppViews.tsx:1680-1681`
- Fallback branch for old Safari after the `'addEventListener' in mediaQuery` guard. TS
  narrows the object to `never` in the else branch, so `.addListener` errors.
- **Effect:** none — it's an intentional legacy fallback; just untyped.
- **✅ Fixed:** cast `mediaQuery` to a type exposing optional `addListener`/`removeListener`
  and call them with optional chaining. Slightly safer than before (won't throw if a browser
  lacks both APIs) while keeping the legacy path.

### B5. `useBudgetApp` recurring `kind` widened to `string`
- **File:** `src/hooks/useBudgetApp.ts:1296`
- An imported/parsed recurring object types `kind` as `string`, not `RecurringKind`,
  so a `persistLocal(current => …)` updater isn't assignable to `DataState`.
- **Effect:** type-only; the runtime data is coerced elsewhere. Worth tightening.
- **✅ Fixed:** cast the sanitized `kind`/`recurrence_type` to `RecurringKind`/`RecurrenceType`
  (object-literal widening was turning the string-literal unions into `string`).

### B6. `backupService` zip.js + body types
- **File:** `src/services/backupService.ts:141,222,223`
- L141: `invoke<T>(fn, body: unknown)` passes `unknown` into `functions.invoke`'s typed `body`.
- L222-223: `entry.getData` — zip.js `Entry` is a `FileEntry | DirectoryEntry` union and
  `DirectoryEntry` lacks `getData`; the code guards with `!entry.getData` so it's safe at
  runtime.
- **Effect:** type-only; both paths work at runtime.
- **✅ Fixed:** cast the `invoke` body to `Record<string, unknown>` at the call site, and
  cast the found zip entry to a shape exposing optional `getData` (the existing
  `!entry.getData` guard is preserved).

---

## C. Project / configuration issues

### C1. `@netlify/functions` is not a declared dependency
- **Files:** `netlify/functions/market-quotes.ts:1`, `netlify/functions/receipt-scan.ts:1`
  import from `@netlify/functions`, which is **not in `package.json`** and not installed
  locally. It's a **type-only** import (`import type { Handler }`), erased at bundle time,
  and Netlify provides it in its build image — so deploys work. But it's undeclared, so
  local typechecking of the functions and any future non-type import would fail.
- **Recommendation:** add `@netlify/functions` to `devDependencies`.
- **✅ Fixed:** added `@netlify/functions` to `devDependencies` (`^5.3.0`). The functions
  now typecheck cleanly; deploys are unaffected (the import is type-only).

### C2. Netlify functions are outside the typecheck net
- `tsconfig.json` `include` is `["src"]` only, so `netlify/functions/*` and
  `supabase/functions/*` are never type-checked by `tsc`. Errors there won't surface locally.
- **Left as-is (by design):** these directories target different runtimes (Netlify /
  Deno) with their own type environments; pulling them into the app `tsconfig` would create
  more noise than it removes. Verified separately that `netlify/functions/*.ts` typecheck
  cleanly against the newly-declared types.

### C3. `npm audit`: esbuild/vite dev-server vulnerability
- 1 high + 1 moderate, both from `esbuild <=0.24.2` (via `vite`). This is a **dev-server-only**
  issue (a website can send requests to the local dev server), not a production risk. The fix
  is `vite@8` — a **breaking** major bump — so evaluate before applying.
- **⏸ Intentionally deferred:** upgrading Vite 5 → 8 is a breaking major change that could
  destabilize the build/config, which directly conflicts with the "make sure nothing breaks"
  requirement. Since the advisory affects only the local dev server (never the deployed
  production bundle), it was left untouched. Recommend scheduling the `vite@8` upgrade as its
  own isolated change with a full smoke test.

### C4. `.gitignore` does not ignore env files
- **File:** `.gitignore` — only `node_modules/` and `dist/`. No `.env` / `.env.local`.
  No env file is currently committed, but add `.env*` to prevent accidentally committing
  `VITE_SUPABASE_*` or function secrets.
- **✅ Fixed:** added `.env` / `.env.*` (keeping `!.env.example`), plus `.netlify/`,
  `*.tsbuildinfo`, and `.DS_Store`.

### C5. Main bundle is large (informational)
- `dist/assets/main-*.js` = **1,188 kB** (362 kB gzipped); Vite warns it exceeds 500 kB.
  Driven largely by `AppViews.tsx` (**9,338 lines** in one file). Not an error — a
  maintainability/performance flag. Consider `manualChunks` / route-level `import()` and
  splitting `AppViews.tsx`.
- **⏸ Intentionally deferred:** this is a performance/maintainability improvement, not a
  bug. Code-splitting a 9.3k-line file and reworking chunking carries real regression risk
  and is out of scope for an error-fix pass. Recommend tackling it as a focused refactor.

---

## Summary table

| # | Severity | Location | Issue | Status |
|---|----------|----------|-------|--------|
| A1 | **High (functional)** | AppViews.tsx:4875 | Reports recurring data always empty (`recurring` vs `sortedRecurring`) | ✅ Fixed |
| A2 | Medium (dead code) | PwaInstallPrompt.tsx:4 | Dismiss button bound to undefined `dismiss` | ✅ Fixed |
| A3 | Low (cosmetic) | AppViews.tsx:6076 | Recurring `emoji` never set; always `🔁` | ✅ Fixed |
| A4 | Low (dead code) | InvestmentsView.tsx | `logoUrl` fallback unreachable (should be `logo_url`) | ✅ Fixed |
| B1 | Low (type) | App.tsx:65/792 | `'utilities_hub'` not accepted by Sidebar | ✅ Fixed |
| B2 | Low (type) | AppViews.tsx ×13 | color helper params typed too narrowly | ✅ Fixed |
| B3 | Low (type) | AppViews.tsx ×4 | `replaceAll` needs `lib: ES2021` | ✅ Fixed |
| B4 | Low (type) | App.tsx / AppViews.tsx | legacy matchMedia `never` | ✅ Fixed |
| B5 | Low (type) | useBudgetApp.ts:1296 | recurring `kind` widened to `string` | ✅ Fixed |
| B6 | Low (type) | backupService.ts | zip.js `getData` + `unknown` body | ✅ Fixed |
| C1 | Medium (config) | netlify/functions/* | `@netlify/functions` undeclared dep | ✅ Fixed |
| C2 | Low (config) | tsconfig.json | functions not typechecked | ↔ Left by design |
| C3 | Medium (security) | vite/esbuild | dev-server audit advisory (breaking fix) | ⏸ Deferred (breaking) |
| C4 | Low (hygiene) | .gitignore | env files not ignored | ✅ Fixed |
| C5 | Info | AppViews.tsx / bundle | 1.19 MB main chunk; 9.3k-line file | ⏸ Deferred (refactor) |

**Result:** all 38 TypeScript errors resolved (`tsc` clean), every functional bug fixed,
build still green. Two items deferred on purpose (C3 breaking upgrade, C5 large refactor)
to honor the "nothing breaks" constraint — both are non-blocking and documented above.
