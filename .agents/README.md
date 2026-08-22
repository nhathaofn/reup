# TediaPros Agent Skills

TediaPros-specific skills are located in `.agents/skills/`. The root `AGENTS.md` file contains the accompanying instructions and must be distributed with the skill set.

## Use on Another Machine

Place both `AGENTS.md` and `.agents/skills/` in the TediaPros Git checkout. Codex will automatically discover skills under `.agents/skills/` while working in the repository.

## Automatic Routing

Every skill keeps `policy.allow_implicit_invocation: true` in `agents/openai.yaml`. The agent must identify skills from the prompt's intent and boundaries based on the `description` in `SKILL.md`; the user does not need to invoke `$skill-name`. `feature-workflow` is the mandatory router for a non-trivial feature or behavior change and selects any additional specialized skills that are actually triggered. `infrastructure-boundary` protects the shared owner of packaged media runtimes, server AI providers, storage, and queues; `lan-networking` preserves the mandatory server/LAN contract and evidence level; `external-runtime` changes runtime lifecycle without overriding the product's existing bundled/on-demand choice; `build-release` preserves the Windows artifact contract.

`AGENTS.md` and all of `.agents/skills/` form a single distribution contract: do not commit or push a skill reference in `AGENTS.md` unless the corresponding skill folder exists in the same Git tree. Before pushing, verify that every skill has `SKILL.md`, `agents/openai.yaml`, and `policy.allow_implicit_invocation: true`.

## Skill Validation

The Codex Skill Creator validator requires PyYAML. On a machine with `uv`, run:

```bash
for skill in .agents/skills/*; do
  uv run --with PyYAML -- python3 "${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-creator/scripts/quick_validate.py" "$skill"
done
```

If the environment already has the `yaml` module, replace `uv run --with PyYAML -- python3` with `python3`.

After each feature change, run the full-base gate from the repository root:

```bash
node verify-base.mjs
```

You may run `node verify-base.mjs server` or `node verify-base.mjs client` to diagnose an individual stage; before completion, you must still run the default gate that includes both stages.
