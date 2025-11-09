# How-To Guides

Task-oriented guides for common operations.

---

## Agent Development

- [Add a Persona](add-a-persona.md) - Create new agent roles
- [Add a Project](add-a-project.md) - Define new production types

## Workflow Integration

- [Add External Workflow](add-external-workflow.md) - Integrate n8n workflows

## Testing

- [Run Integration Tests](run-integration-tests.md) - Test coordination flows

## Deployment

- [Release Cut and Rollback](release-cut-and-rollback.md) - Safe deployments

---

## Quick Reference

### Common Tasks

**Add new agent:**
1. Create `data/personas/name.json`
2. Run `npm run migrate:personas`
3. Add to project workflow
4. Test handoff chain

**Add new project:**
1. Create `data/projects/slug.json`
2. Run `npm run migrate:projects`
3. Test Casey detection
4. Verify workflow progression

**Deploy to production:**
1. Tag release
2. Backup database
3. Run migrations
4. Deploy services
5. Verify health

---

## Need More?

See [docs/README.md](../README.md) for complete documentation index.

