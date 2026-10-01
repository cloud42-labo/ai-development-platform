# Skills

Executable procedures that install, upgrade, validate and safety-check this
package. See `../docs/versioning-policy.md` for what MAJOR/MINOR/PATCH mean
for this class (`skills_version` in `../adp-package.yaml`).

## This class is hosted in another repository

Unlike Rules, Schemas, Workflows and Templates, the Skills class has **no
files in this repository**. It lives in `cloud42-labo/skills` under
`.claude/skills/adp-bootstrap/`, named by `skills_source` in
`../adp-package.yaml`.

That is deliberate, not an oversight. `cloud42-labo/skills` is where every
Claude Code Skill for this organization already lives, and a Skill has to sit
in that repository's layout to be loadable at all. Copying `adp-bootstrap`
into this repository to make the package "self-contained" would duplicate a
canonical file — exactly what `README.md`'s "Why an index instead of a move"
rejects for the in-repo classes — and would leave two copies to drift apart.

The practical consequence for an adopter is that the table below is the one
place in this package where the links are **not** resolvable relative to this
repository. Fetching this class is a separate step from cloning ADP.

## Files

| File | What it does |
|---|---|
| [`SKILL.md`](https://github.com/cloud42-labo/skills/blob/main/.claude/skills/adp-bootstrap/SKILL.md) | The Skill itself: preflight → plan → install → configure, dry-run by default, and the handoff rule for Human-only operations |
| [`scripts/plan.py`](https://github.com/cloud42-labo/skills/blob/main/.claude/skills/adp-bootstrap/scripts/plan.py) | Parses `adp-package.yaml` and the `package/*.md` indexes; resolves the file set and computes install/upgrade plans (ADP-049-D/E) |
| [`scripts/apply.py`](https://github.com/cloud42-labo/skills/blob/main/.claude/skills/adp-bootstrap/scripts/apply.py) | Applies a plan into a target working tree, substituting environment-specific values (ADP-049-D) |
| [`scripts/doctor.py`](https://github.com/cloud42-labo/skills/blob/main/.claude/skills/adp-bootstrap/scripts/doctor.py) | Checks version consistency, missing/drifted files, required capabilities and unapplied migrations; exits 0/1 (ADP-049-F1) |
| [`scripts/scan_secrets.py`](https://github.com/cloud42-labo/skills/blob/main/.claude/skills/adp-bootstrap/scripts/scan_secrets.py) | Scans the resolved distribution file set for secrets, personal values and Cloud42-specific IDs/URLs (ADP-049-F2) |
| [`references/config-mapping.md`](https://github.com/cloud42-labo/skills/blob/main/.claude/skills/adp-bootstrap/references/config-mapping.md) | Which environment-specific values an adopter supplies, and where each is substituted |

## Known gap: this class is not yet self-checking

`plan.py` hardcodes its own asset-class map:

```python
ASSET_CLASSES = {
    "rules": "rules_version",
    "schemas": "schema_version",
    "workflows": "workflow_version",
    "templates": "templates_version",
}
```

`doctor.py` imports that same map. So `skills_version` is parsed out of the
manifest but participates in no comparison: a Skill that has drifted from the
version recorded here will not be reported by `doctor`, and `plan` will not
list `skills` among its changed classes.

Closing that gap means editing `ASSET_CLASSES` (and teaching it that this one
class resolves through `skills_source` rather than a relative path) in
`cloud42-labo/skills`, not here — it is follow-up work in that repository.
Until it lands, compare `skills_version` by hand at upgrade time. The
`migration_path` entry that introduced this class records the same caveat so
an adopter reading only the manifest still sees it.
