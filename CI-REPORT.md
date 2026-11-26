# CI / Vercel deployment failure report

Investigated 2026-11-26 on `ops/ci`. Scope: `koredeycodes-projects/handshake-reactive`
(project ID `prj_EYOzeYPQuCvQuw5kuDoFl9tqZ7Hb`, Git repo `koredeycode/handshake-reactive`,
production branch `main`). **No GitHub Actions runs exist; all failure emails come from
Vercel Git integration builds.**

## Evidence gathered

| Command | Result |
|---|---|
| `gh run list --limit 30` | no output |
| `gh api repos/koredeycode/handshake-reactive/actions/workflows` | no workflows |
| `gh api repos/koredeycode/handshake-reactive/actions/runs` | `total_count: 0` |
| `.github/workflows/` in repo | directory does not exist |
| `vercel project inspect handshake-reactive` | Root Directory `.`, Framework Preset Vite, Build Command "`npm run build` or `vite build`", Install Command auto, Production Branch `main`, Git connected |
| `vercel ls handshake-reactive` | 10 failed deployments (7 production, 3 preview) in the last ~52 min; 1 successful CLI deploy |
| `vercel inspect <url> --logs` | every failure ends with `sh: line 1: vite: command not found` / `[BUILD_UTILS_SPAWN_127] Command "vite build" exited with 127` |
| `vercel logs <failed-url> --scope koredeycodes-projects --project handshake-reactive` | 0 runtime records — builds failed before serving traffic |
| `vercel alias ls` | `handshake-reactive-git-main`, `-git-docs-sourcify`, `-git-redesign-ui` aliases all point at **failed** Git deployments; `handshake-reactive.vercel.app` still points at the earlier **Ready** CLI deployment `ui-mr4oezk78` |

## Failed deployments

Timestamps are from `vercel inspect` (`created`, West Africa Time, UTC+1); the log column
gives the UTC timestamp of the fatal line in `vercel inspect <url> --logs`.

| # | Deployment URL | Environment / branch (commit) | Created (WAT) | Fatal log line (UTC) | Alias assigned |
|---|---|---|---|---|---|
| 1 | https://ui-gsk19c5n2-koredeycodes-projects.vercel.app | Preview, `deploy/ui` (`5a647d2`) | 2026-11-26 08:46:44 | 07:46:59 `vite: command not found` | `ui-git-deploy-ui` |
| 2 | https://ui-dsc38pb5w-koredeycodes-projects.vercel.app | Production, `main` (`e55cca6`) | 2026-11-26 08:49:32 | 07:49:46 `vite: command not found` | `ui-git-main` |
| 3 | https://ui-adrudmqo6-koredeycodes-projects.vercel.app | Production, `main` (`7611e65`) | 2026-11-26 08:49:41 | 07:50:01 `vite: command not found` | `ui-git-main` |
| 4 | https://handshake-reactive-qoelwava3-koredeycodes-projects.vercel.app | Preview, `docs/sourcify` (`c581bed`) | 2026-11-26 08:58:55 | 07:59:07 `vite: command not found` | `handshake-reactive-git-docs-sourcify` |
| 5 | https://handshake-reactive-7l13fnx6l-koredeycodes-projects.vercel.app | Production, `main` (`ccbce00`) | 2026-11-26 08:59:45 | 08:00:01 `vite: command not found` | `handshake-reactive-git-main` |
| 6 | https://handshake-reactive-2jtbh5lrl-koredeycodes-projects.vercel.app | Production, `main` (`7dff347`) | 2026-11-26 09:00:59 | 08:01:31 `vite: command not found` | `handshake-reactive-git-main` |
| 7 | https://handshake-reactive-1cvkq7ywa-koredeycodes-projects.vercel.app | Production, `main` (`19acce8`) | 2026-11-26 09:06:28 | 08:07:01 `vite: command not found` | `handshake-reactive-git-main` |
| 8 | https://handshake-reactive-gkh6iju9b-koredeycodes-projects.vercel.app | Preview, `redesign/ui` (`95eae8a`) | 2026-11-26 09:14:44 | 08:15:16 `vite: command not found` | `handshake-reactive-git-redesign-ui` |
| 9 | https://handshake-reactive-d7f3qu8oo-koredeycodes-projects.vercel.app | Production, `main` (`b61a7e8`) | 2026-11-26 09:22:19 | 08:22:50 `vite: command not found` | `handshake-reactive-git-main` |
| 10 | https://handshake-reactive-7c4xdkaz4-koredeycodes-projects.vercel.app | Production, `main` (`a941934`) | 2026-11-26 09:24:27 | 08:24:44 `vite: command not found` | `handshake-reactive-git-main` |

Working reference: https://handshake-reactive.vercel.app → `ui-mr4oezk78` (`Ready`);
its build log has no `Cloning github.com/...` line (it was uploaded by the CLI from `ui/`),
and completes with build-cache upload. https://ui-cahbzl55d-koredeycodes-projects.vercel.app
is another `Ready` CLI deploy from 08:45:15 WAT.

## Root cause

**(a) Vercel Git integration auto-deploys every push, plus (b) the wrong build root.**

Every failed build log starts with:

```
Cloning github.com/koredeycode/handshake-reactive (Branch: main, Commit: a941934)
...
Installing dependencies...
added 2 packages, removed 581 packages, and changed 3 packages in 8s
...
sh: line 1: vite: command not found
Error: [BUILD_UTILS_SPAWN_127] Command "vite build" exited with 127
```

- The repo was connected to Git during the original CLI deploy (`VERCEL.md` records this).
  Since then, **every push to `main` and to any branch** triggers a Vercel build; the `git-*`
  aliases in `vercel alias ls` prove the deployments are Git-driven, not CLI-driven.
- The project's Root Directory is `.` and the Vite preset defaults to `vite build`.
  At the repo root, `package.json` is `handshake-tooling`: it has **no `build` script and
  no `vite` dependency** (only `viem`, `tsx`, `typescript`, `@types/node`). The real app is
  `ui/package.json`, whose build is `tsc -b && vite build` with `vite` in devDependencies.
  The cached UI `node_modules` is pruned by the root install (`removed 581 packages`), then
  `vite` is absent → exit 127.
- The working site is produced only by the manual path documented in `VERCEL.md`:
  `cd ui && vercel deploy --prod --yes`. That deploy installs `ui/package-lock.json` and
  builds in `ui/`, so it succeeds. The two deploy paths coexist: Git deploys fail and the
  production domain keeps pointing at the older successful CLI deploy.

**Ruled out:**

- *Project rename side effects (c):* the first three failures (`ui-*`) happened **before**
  the project rename, and post-rename `handshake-reactive-*` failures have byte-identical
  errors. Only the alias prefix changed.
- *GitHub Actions:* zero workflows and zero runs; `gh run view` has nothing to view.
- *Missing environment variables / contract configuration:* the build never reaches app
  code; it dies at command lookup. `ui/public/contracts.json` is a static asset copied at
  build time and is not involved.
- *A broken UI build:* `npm ci --prefix ui && npm run build --prefix ui` was re-run locally
  on this branch and succeeded (`tsc -b && vite build`, ✓ built in 8.93s). Only a
  >500 kB chunk-size advisory is emitted.

## Concrete minimal fix

Pin the Vercel build to the existing `ui/` workspace in a root `vercel.json` so
Git-triggered builds use the correct dependencies and script, and keep the SPA rewrite:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "installCommand": "npm ci --prefix ui",
  "buildCommand": "npm run build --prefix ui",
  "outputDirectory": "ui/dist",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

`buildCommand`, `installCommand` and `outputDirectory` in `vercel.json` override project
settings for the deployments built from that commit, so no dashboard change is required.
This is applied in this branch. `VERCEL.md` is updated to declare one canonical deploy
path — Git integration on push to `main` — with the CLI retained only as an escape hatch.

Alternative dashboard-only fix (not applied here, no repo change): set the project's
**Root Directory** to `ui` in Vercel Project Settings → Build and Deployment. Either fix
removes the failure emails; do **not** do both blindly, since a root `vercel.json` will
override the dashboard build command.

## Follow-up verification after merge

1. Push a commit to `main`, then confirm the new `*-git-main-*` deployment is `Ready`
   (`vercel ls handshake-reactive`) and that `handshake-reactive.vercel.app` now serves it.
2. Optionally remove stale `*-git-*` aliases pointing at failed deployments in the Vercel
   dashboard; they are cosmetic and do not affect the production domain.
