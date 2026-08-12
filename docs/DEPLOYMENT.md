# Vercel deployment

## Deployment contract

GitHub Actions is the only deployment owner for this repository:

- Every pull request and every push runs `npm ci`, `npm run typecheck`, and
  `npm run build` on Node.js 24.
- A push to `main` deploys to the Vercel Production environment only after the
  validation job passes.
- Pull requests do not create Vercel Preview deployments under this contract.
- [`vercel.json`](../vercel.json) sets `git.deploymentEnabled` to `false`, so
  connecting the GitHub repository in Vercel does not create a second automatic
  deployment for the same commit.

Do not re-enable Vercel Git deployments while the Actions deployment job is
enabled. If the team later chooses Vercel Git deployments, first remove or
disable the `deploy-production` job, then set `git.deploymentEnabled` to `true`.

## Current Vercel project

Setup was completed on 2026-08-12:

- Team: `jjh's projects` (`jjhs-projects-4d22a2fd`)
- Project: `incheon-care-map`
- Vercel Node.js version: `24.x`
- Local checkout: linked through `.vercel/project.json`
- GitHub repository secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and
  `VERCEL_PROJECT_ID` are configured
- Token: dedicated to this project and expires on 2027-08-13; its value is not
  stored in this repository

The project may stay connected to GitHub for repository metadata; automatic Git
deployments remain disabled by `vercel.json`.

## Re-linking or rotating credentials

From the repository root:

```bash
npm install --global vercel@latest
vercel login
vercel link --yes --scope jjhs-projects-4d22a2fd --project incheon-care-map
```

The link command targets the existing `incheon-care-map` project and creates
`.vercel/project.json`, which contains the required `orgId` and `projectId`.
`.vercel/` is local state and must not be committed.

When rotating the token, create a new project-scoped Vercel access token at
<https://vercel.com/account/settings/tokens>, replace the GitHub repository
secret, verify the next production deployment, and then revoke the old token.
The workflow uses these GitHub **repository secrets**:

| Secret | Value |
| --- | --- |
| `VERCEL_TOKEN` | Vercel access token with access to the selected team/project |
| `VERCEL_ORG_ID` | `.vercel/project.json` → `orgId` |
| `VERCEL_PROJECT_ID` | `.vercel/project.json` → `projectId` |

The interactive commands below update them without writing the token into shell
history:

```bash
gh auth status
gh secret set VERCEL_TOKEN --repo ulsaninuhack/hack
gh secret set VERCEL_ORG_ID --repo ulsaninuhack/hack --body "$(jq -r .orgId .vercel/project.json)"
gh secret set VERCEL_PROJECT_ID --repo ulsaninuhack/hack --body "$(jq -r .projectId .vercel/project.json)"
gh secret list --repo ulsaninuhack/hack
```

The workflow pins Vercel CLI `58.9.4`, the current release when this deployment
contract was created. Update that version intentionally in the workflow after
checking the Vercel CLI release and rerunning CI.

The Vercel project's Node.js setting is already `24.x` in **Project Settings →
Build and Deployment**. Keep it aligned with the Node.js 24 version pinned by
the Actions runner.

## Data upload boundary

The repository can contain the complete source data pack through Git LFS, but
the deployment checkout explicitly leaves LFS payloads unresolved and
`.vercelignore` excludes the root `data/` and source-data directories. Only
curated browser-safe exports under `public/data/` are web-build inputs and are
served by the deployed application.

Do not import files from root `data/` into application code. Copy only reviewed
runtime exports to `public/data/` and keep that directory small enough for a web
deployment.

## Verification and operations

Run the same checks locally before pushing:

```bash
npm ci
npm run typecheck
npm run build
```

After the first push to `main`, inspect the workflow and deployment:

```bash
gh run list --repo ulsaninuhack/hack --workflow "CI / Vercel" --limit 5
gh run watch --repo ulsaninuhack/hack
vercel project inspect
vercel ls --environment=production
```

The `Deploy production` job writes the immutable deployment URL to the GitHub
job summary and registers it as the `production` environment URL. A missing
secret fails before any Vercel command runs and names only the missing secret,
never its value.

Recommended branch protection for `main`: require the status check
`CI / Vercel / Validate (Node 24)` and require pull requests before merging.

## Official references

- [Vercel GitHub Actions deployment](https://vercel.com/docs/git/vercel-for-github#using-github-actions)
- [Vercel CLI deployment](https://vercel.com/docs/cli/deploy)
- [`git.deploymentEnabled`](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentEnabled)
- [`.vercelignore`](https://vercel.com/docs/deployments/vercel-ignore)
- [GitHub Node.js workflow](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs)
- [`actions/setup-node`](https://github.com/actions/setup-node)
