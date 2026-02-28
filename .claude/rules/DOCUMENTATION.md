# Documentation

## Mandatory Docs

| File | Content |
|------|---------|
| `README.md` | What it is, quickstart, badges |
| `docs/architecture.md` | System design, component map |
| `docs/configuration.md` | All env vars — type, default, description |
| `docs/deployment/kubernetes.md` | K8s deployment reference |
| `docs/security.md` | Permission model, trust boundaries |
| `docs/api.md` | HTTP API reference (if applicable) |

## Update Triggers

| Change | Doc to Update |
|--------|--------------|
| New env var | `docs/configuration.md` |
| New HTTP endpoint | `docs/api.md` |
| Architecture change | `docs/architecture.md` |
| New K8s mounts/ports | `docs/deployment/kubernetes.md` |
| Security model change | `docs/security.md` |

## `docs/planned/` — Draft Specs

Committed design docs for unimplemented features. Set `status: done` when shipped — never
delete specs. Keep `docs/planned/index.md` in sync when specs are added or ship.

## PR Checklist
- [ ] New env vars in `docs/configuration.md`
- [ ] New endpoints in `docs/api.md`
- [ ] `planned/index.md` updated if spec shipped or added
- [ ] No stale references to renamed config keys
