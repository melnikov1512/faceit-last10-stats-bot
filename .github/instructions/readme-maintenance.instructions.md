---
applyTo: "README.md,.github/workflows/**,package.json,.github/agents/**,.github/instructions/**,.github/skills/**,.github/prompts/**,docs/*.md"
---

After modifying this file, check whether `README.md` needs updating.

Update `README.md` if the change affects any of the following:
- `npm` scripts listed in the **Commands** section (added, renamed, removed, or changed behaviour)
- Prerequisites (Node.js version, new required secrets or environment variables)
- CI/CD workflows (new workflow, renamed job, changed trigger)
- Project structure (new top-level directory or significant structural change)
- GitHub Copilot integration counts or file listings (agents, skills, instruction files, prompts)
- Repository secrets or variables that users must configure
- A new top-level doc file added under `docs/` (e.g. `docs/*.md`) that end users or contributors should discover — add a link to it in the relevant README section

Skip if the change is cosmetic, a bug fix with no user-visible impact, or already accurately reflected in `README.md`.
