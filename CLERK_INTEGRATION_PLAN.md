# Clerk Integration & Templates Cascade — Plan & Status

This file is the source of truth for the in-flight work to:
1. Move templates out of the PyPI wheel and serve them from a private repo via a Netlify proxy
2. Gatekeep template access with a Clerk login (only authenticated users get the protected templates)
3. Rip out the legacy GitHub-OAuth + codespace-sync feature set as part of the cleanup

**Read this first if context was lost.** It tells you where we are, what's done, what's pending, and exactly what to do next.

Last updated: 2026-05-02

---

## 1. The goal

Today, when a user clicks **Build** in the IDE, the backend (`server.py:519`) hardcodes a fetch from `https://vibefoundry.ai/templates/AGENTS.md` (with a wheel-bundled fallback). Templates are public; everyone gets them.

We want:
- Templates live in a **private** location (not on the public website, not bundled into the pip package)
- Only **authenticated users** (paid customers eventually, defined by Clerk login state) can pull them
- Anonymous users still get **a** Build experience — fall back to the existing public website cascade
- The IDE's existing GitHub-OAuth-based "codespace sync" feature is gone (user explicitly asked for the rip)
- Clerk becomes the single auth system for the IDE; later, the website (currently using Memberstack) will migrate to Clerk too as a separate project (NOT part of this work)

## 2. Architecture (end state)

```
┌────────────────────────────────────────────────────────┐
│  IDE (Python+FastAPI backend, React frontend)          │
│  Distributed via PyPI as `vibefoundry`                 │
│                                                         │
│  • <ClerkProvider> wraps React app                     │
│  • Sign-in via Clerk (GitHub social provider)          │
│  • Frontend gets session JWT via clerk.getToken()      │
│  • Build button POSTs to local /api/build              │
│  • /api/build forwards JWT to remote /api/templates    │
└──────────────────────┬─────────────────────────────────┘
                       │ Authorization: Bearer <jwt>
                       ▼
┌────────────────────────────────────────────────────────┐
│  vibefoundry.ai/api/templates  (Netlify Function)      │
│  • Validates JWT with @clerk/backend.verifyToken       │
│  • If valid → fetches files from GitHub Contents API   │
│  • Uses GITHUB_PAT env var (fine-grained, read-only)   │
│  • Reads from vibefoundry/vibefoundry-ide @ dev_branch │
│  • Path: templates/* (i.e. templates/AGENTS.md, …)    │
└──────────────────────┬─────────────────────────────────┘
                       │ GitHub Contents API
                       ▼
┌────────────────────────────────────────────────────────┐
│  github.com/vibefoundry/vibefoundry-ide  (PRIVATE)     │
│  Branch: dev_branch                                    │
│  Folder: templates/                                    │
│    • AGENTS.md (currently the only template)           │
└────────────────────────────────────────────────────────┘
```

Anonymous fallback (Step 6, not yet implemented): if the IDE has no Clerk session, the Build endpoint falls back to fetching from `https://vibefoundry.ai/templates/AGENTS.md` (the existing public path), so unauthenticated users still get *something*.

## 3. Decisions made (and rationale, so future-you can question them)

| Decision | Choice | Why |
|---|---|---|
| Where do templates live? | Inside this repo (`vibefoundry-ide`), at `templates/` at root | Repo is already private, separate repo would be over-engineering for one file |
| Where does the proxy live? | Netlify Function in the **website** repo (`vibefoundry/website`) | Website is already on Netlify; adding a function there is one less Netlify site to manage. Proxy is at `vibefoundry.ai/api/templates/*` |
| What auth provider? | Clerk | User chose. Will eventually unify website auth onto Clerk too (separate project) |
| Clerk dev or prod? | **Production** | User has DNS access to vibefoundry.ai. Avoids future swap. Custom domain `clerk.vibefoundry.ai` |
| Which GitHub branch does the proxy read? | `dev_branch` | User's "main is wonky", `dev_branch` is the canonical source of truth |
| What happens if anon user clicks Build? | Falls back to existing `vibefoundry.ai/templates/AGENTS.md` cascade | Avoids breaking offline/anon UX |
| Single login for IDE + website? | Eventually yes (Clerk on both) | Out of scope for this work — separate ~1 week migration project |
| Is codespace sync staying? | **No, removed entirely** | User decision: "delete the entire virtual space, I don't want a messy repo" |

## 4. Credentials & env vars (where things live)

**Don't commit any of these. They're already set in the right places.**

- **GitHub PAT** (read-only, fine-grained, scoped to `vibefoundry/vibefoundry-ide`)
  - Lives in: Netlify env vars on `vibefoundry.ai` site, key `GITHUB_PAT`
  - Generated at: https://github.com/settings/personal-access-tokens
  - Permissions: Repository permissions → Contents: Read-only

- **Clerk Production keys**
  - Publishable: starts `pk_live_Y2xlcm…` (safe to share — get the full value from the Clerk dashboard's API Keys page; will be hardcoded in the frontend at Step 5b)
  - Secret: starts `sk_live_…` (NEVER paste in code, chat, or commits — Clerk's token format is identical to Stripe's, so GitHub's push-protection flags it; it lives in Netlify env vars only)
  - Lives in: Netlify env vars on `vibefoundry.ai` site, key `CLERK_SECRET_KEY`
  - Clerk app: dashboard.clerk.com, app name "VibeFoundry", Production instance

- **Clerk custom domain**
  - `clerk.vibefoundry.ai` (verified, all 5 CNAMEs propagated and green in Clerk dashboard)
  - DNS: GoDaddy, vibefoundry.ai zone

- **GitHub OAuth app** (powers Clerk's GitHub social login in production)
  - Created at: https://github.com/settings/developers
  - Name: "Vibefoundry"
  - Homepage URL: https://vibefoundry.ai
  - Callback URL: https://clerk.vibefoundry.ai/v1/oauth_callback
  - Client ID: visible in Clerk → SSO Connections → GitHub (and on github.com/settings/developers)
  - Client Secret: stored in Clerk only; not committed anywhere. The original was visible in chat history during setup — rotate at github.com/settings/developers post-completion if you care.

## 5. Step-by-step status

### ✅ Step 1 — Decouple templates from PyPI wheel — COMPLETE

- Removed `templates/*` from `package-data` in `pyproject.toml` (line 64)
- Built wheel locally, verified `templates/` no longer in the artifact
- `templates/AGENTS.md` still exists in the source tree, just not bundled
- Committed: yes (commit `e459bb4` on `dev_branch`)

### ✅ Step 2 — Seed template repo — COMPLETE

- Reusing this repo (already private) instead of a separate one
- Moved `src/vibefoundry/templates/AGENTS.md` → `templates/AGENTS.md` (repo root)
- Used the newer ~68KB version from `reference files/AGENTS.md` (was edited 2026-05-02)
- Deleted the old `reference files/AGENTS.md` to avoid drift between two copies
- Committed: yes (commit `e459bb4` on `dev_branch`)

### ✅ Step 3 — Build Netlify Function proxy (no auth) — COMPLETE

- Function at `vibefoundry-platform-real/netlify/functions/templates.js` in the **website repo**
- Redirects in `vibefoundry-platform-real/netlify.toml`:
  - `/api/templates` → `/.netlify/functions/templates`
  - `/api/templates/*` → `/.netlify/functions/templates/:splat`
- Reads `vibefoundry/vibefoundry-ide` @ `dev_branch`, folder `templates/`
- Committed + pushed to website repo `main` (commit `7e22925`)
- Verified end-to-end:
  - `GET https://vibefoundry.ai/api/templates` → 200, JSON listing showing AGENTS.md (68061 bytes)
  - `GET https://vibefoundry.ai/api/templates/AGENTS.md` → 200, raw markdown, byte-for-byte identical to local

### ✅ Step 4 — Add Clerk JWT validation to proxy — COMPLETE

- Installed `@clerk/backend` in website repo (added to `package.json`)
- Updated `templates.js` to call `verifyToken(jwt, { secretKey: CLERK_SECRET_KEY })`
- Returns 401 for missing/invalid tokens, falls through to GitHub fetch on valid tokens
- Committed + pushed to website repo `main` (commit `998005e`)
- Verified:
  - No header → `401 Authorization required`
  - Bogus token → `401 Invalid or expired token: …`
  - Valid token → not yet tested (needs Step 5b for a real Clerk-issued JWT; this is fine, will be tested as part of Step 5b)

### 🚧 Step 5a — Remove codespace sync and GitHub auth — IN PROGRESS

User asked: "delete the entire virtual space, I don't want a messy repo." This is a clean rip of the legacy GitHub-OAuth + codespace-sync feature.

**Files already deleted (uncommitted):**
- `frontend/src/components/LoginScreen.jsx`
- `frontend/src/components/CodespaceSync.jsx`
- `frontend/src/components/SplitWorkspace.jsx`
- `frontend/src/components/SplitWorkspace.css`
- `frontend/src/utils/github.js`
- `frontend/src/utils/auth.js`
- `frontend/src/utils/codespaceSync.js`

**Still to do in this step:**
1. **`frontend/src/App.jsx`** (1457 lines, 97 references): Remove imports, state, handlers, and JSX referencing the deleted files. Specifically:
   - Imports at lines 5, 10, 11, 16, 17, 18 (CodespaceSync, LoginScreen, SplitWorkspace, codespaceSync utils, github.js, auth.js)
   - State: `activeTab`, `codespaceFiles`, `codespaceExpandedPaths`, `codespaceCollapsed`, `syncConnection`, `authStatus`, `authUser`, `showSplitWorkspace` (and any other codespace-related)
   - Effects/handlers: validateAccess on mount, codespace tab switching, pull-from-codespace, push-to-codespace, anything calling `/api/sync/*`, anything calling `getStoredUser`
   - JSX: the LoginScreen gate, the codespace tab UI, the SplitWorkspace conditional render (lines ~1431-1440), Pull/Push buttons
   - **Keep** the standalone preview iframe (lines ~1179-1205) — it's local Streamlit preview, not codespace-related, just shares `previewUrl` state

2. **`src/vibefoundry/server.py`**: Delete:
   - Lines 1969–~2200: the four `/api/sync/*` endpoints, `SyncPullRequest` and `SyncPushRequest` models, `FORBIDDEN_SYNC_EXTENSIONS`, `PROTECTED_FILES`, `PROTECTED_DIRS` constants
   - Lines 2155+: GitHub OAuth Device Flow endpoints (`DeviceCodeRequest`, `TokenPollRequest`, related routes)
   - Verify nothing else references these
   - **Keep** the `/api/build` endpoint (line 519); it gets rewritten in Step 5b but stays for now

3. **`README.md`**: Remove the "Codespace Integration" and "Bidirectional Sync" feature bullets; update Architecture section.
4. **`pyproject.toml`** description: Currently says "with script running, metadata generation, and GitHub Codespace sync" — drop the codespace mention.
5. **`Makefile`**: Check for any codespace references; probably none.
6. **Verify**: `cd frontend && npm run build` should succeed after the surgery.

**Reversibility note**: All deletions in this step are uncommitted. To back out:
```
git checkout frontend/src/components/LoginScreen.jsx \
             frontend/src/components/CodespaceSync.jsx \
             frontend/src/components/SplitWorkspace.jsx \
             frontend/src/components/SplitWorkspace.css \
             frontend/src/utils/github.js \
             frontend/src/utils/auth.js \
             frontend/src/utils/codespaceSync.js
```

### ⏸ Step 5b — Wire IDE to proxy + add Clerk frontend — BLOCKED on Step 5a

Once codespace is gone, add Clerk:

1. **Frontend**:
   - `cd frontend && npm install @clerk/clerk-react`
   - In `frontend/src/main.jsx`, wrap `<App />` in `<ClerkProvider publishableKey="pk_live_Y2xlcmsudmliZWZvdW5kcnkuYWkk">`
   - In `App.jsx`, gate the IDE on `useAuth()` from Clerk: show `<SignIn appearance={{ ... }}>` when not signed in, IDE when signed in. Configure SignIn to default to GitHub social provider (one click → GitHub OAuth → signed in).
   - When the user clicks **Build**, get session JWT via Clerk's `getToken()`, send it in `Authorization: Bearer <jwt>` header to the local FastAPI's `/api/build`.

2. **Backend (`src/vibefoundry/server.py:519`)**:
   - Modify `build_project()` to accept the Authorization header from the request
   - Replace the `urllib.request.urlretrieve(url, str(dest))` cascade with a fetch to `https://vibefoundry.ai/api/templates/<filename>` that includes the Authorization header
   - First, fetch the directory listing at `https://vibefoundry.ai/api/templates` (returns JSON array), then fetch each file in turn — supports any number of templates, not just `AGENTS.md`
   - Use `httpx.AsyncClient` (already imported) for the requests

3. **Verify**: Sign in via Clerk in the IDE → click Build → confirm `templates/AGENTS.md` appears at `<project>/AGENTS.md`. Network tab should show the JWT being sent and the proxy returning 200.

### ⏸ Step 6 — Wire unauthenticated fallback path — BLOCKED on Step 5b

When the user is not signed in (or Clerk is unreachable):
- Build endpoint should fall back to the existing `https://vibefoundry.ai/templates/AGENTS.md` URL (public path, served by Netlify as a static file)
- Decision: do NOT make Clerk login mandatory at IDE startup; allow skip → free-tier mode → falls back to public templates
- Implementation: in `server.py:519`, wrap the proxy call in try/except; on 401 or no JWT, fall back to public URL

### ⏸ Step 7 — Bump version and publish — BLOCKED on Step 6

- Bump version in `pyproject.toml` and `src/vibefoundry/__init__.py` (currently 0.1.309)
- Run `./publish.sh <new-version>` to push to PyPI
- Tag the commit
- Update README's "Features" list to reflect Clerk + remove codespace
- Optional: a brief release note about the codespace removal so existing users aren't blindsided

## 6. Files & locations

### IDE repo (`vibefoundry-ide`, this one)
- Branch: `dev_branch` (canonical), `main` is "wonky" per user
- Path: `/Users/angelobenedicto/Documents/GitHub/vibefoundry-ide`
- Remote: `git@github.com:vibefoundry/vibefoundry-ide.git` (private)
- Templates folder: `templates/` at repo root
- Backend Build entry point to rewire: `src/vibefoundry/server.py:519`

### Website repo (`website`)
- Path: `/Users/angelobenedicto/Documents/GitHub/website/vibefoundry-platform-real`
- Remote: `git@github.com:vibefoundry/website.git`
- Branch: `main`
- Netlify Function: `netlify/functions/templates.js`
- Netlify config: `netlify.toml` (see `[[redirects]]` for `/api/templates`)
- Vite + React stack; existing `@memberstack/dom` for current website auth

### Netlify
- Site: vibefoundry.ai
- Env vars set: `GITHUB_PAT`, `CLERK_SECRET_KEY` (live)
- Other existing env vars (unrelated): GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET (for website's existing GitHub features), CLIENTS_REPO_URL, GOOGLE_SHEETS_URL — leave alone

## 7. Useful verification commands

**End-to-end proxy test (without auth — should be 401):**
```bash
curl -sS -w "HTTP %{http_code}\n" https://vibefoundry.ai/api/templates
# Expected: 401 Authorization required
```

**Check templates folder is on dev_branch on GitHub:**
```bash
# (Requires being authed to GitHub; or use the proxy via dig instead)
gh api repos/vibefoundry/vibefoundry-ide/contents/templates?ref=dev_branch
```

**Check Clerk DNS records (should already be live):**
```bash
dig clerk.vibefoundry.ai CNAME +short
# Expected: frontend-api.clerk.services.
```

**Verify the wheel doesn't contain templates:**
```bash
cd /Users/angelobenedicto/Documents/GitHub/vibefoundry-ide
rm -rf dist/ && python -m build --wheel 2>&1 | tail -5
unzip -l dist/vibefoundry-0.1.309-py3-none-any.whl | grep -i "templates\|AGENTS\|CLAUDE"
# Expected: no matches
```

## 8. If you lose context — what to do

1. Read this file top to bottom.
2. Run `git status` and `git log --oneline -10` in **both** repos to see what's been committed.
3. Look at the "Step-by-step status" section — find the first step that isn't ✅.
4. For Step 5a specifically: the deletions are already done but uncommitted. Run the reversibility command in Step 5a if the user wants to back out, or proceed with the App.jsx surgery if continuing.
5. Use `TaskList` in the Claude Code session to see canonical task state — it should match this file (single source of truth there is the file; tasks are a UI mirror).
6. Refer to "Credentials & env vars" — everything you need is already set; don't re-create.
7. Don't push to remote without showing the user the diff first.

## 9. Open follow-ups (not blocking, file under "later")

- **Rotate Clerk Secret Key + GitHub OAuth Client Secret** (both were visible in chat screenshots)
- **Clean up `main` branch** of the IDE repo (user said it's "wonky")
- **Migrate website auth from Memberstack to Clerk** (separate ~1 week project)
- **`reference files/CLAUDE.md`** showing as deleted in git status — confirm it was intentional, then commit the deletion
- **`app_folder/meta_data/*` and `frontend/src/App.jsx` modifications** in the original gitStatus — these have since cleared from `git status`; might have been committed in a parallel session, worth a quick check
- **Tier system** (free vs paid templates): not implemented; today's design returns the same templates regardless of plan. Add later by introducing `templates/free/` and `templates/pro/` subfolders + a Clerk plan check.
- **Email branding for Clerk** (currently uses Clerk default; Clerk dashboard nags to set up SendGrid)
