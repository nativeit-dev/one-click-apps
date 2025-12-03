# Quick Reference - Caprover Update Checker

## 🚀 Most Common Commands

```bash
# Quick test (10 apps)
node scripts/advanced_checker.js --limit 10

# Check everything
node scripts/advanced_checker.js

# Preview patch updates
node scripts/advanced_checker.js --dry-run --patch-only

# Apply patch updates (safest)
node scripts/advanced_checker.js --apply --patch-only

# Check specific apps
node scripts/advanced_checker.js --apps wordpress.yml,gitea.yml

# Apply minor + patch updates
node scripts/advanced_checker.js --apply --minor-and-patch
```

## 📊 Update Types

| Symbol | Type | Example | Risk | Auto-Update? |
|--------|------|---------|------|--------------|
| 🟢 | Patch | 1.2.3 → 1.2.4 | Low | ✅ Yes |
| 🟡 | Minor | 1.2.3 → 1.3.0 | Medium | ⚠️ Review |
| 🔴 | Major | 1.2.3 → 2.0.0 | High | ❌ Manual |

## 🛡️ Safety Checklist

- [ ] Run `--dry-run` first to preview changes
- [ ] Start with `--patch-only` for safest updates
- [ ] Review generated markdown report before applying
- [ ] Test updated apps in staging environment
- [ ] Only then apply minor/major updates
- [ ] Always backup before major version updates

## 📁 Important Files

| File | Purpose |
|------|---------|
| `scripts/advanced_checker.js` | Main tool (use this!) |
| `scripts/README.md` | Complete documentation |
| `update-reports/*.md` | Generated reports |
| `.version-cache/*.json` | API cache (1 hour TTL) |

## 🔧 Options Reference

```
--limit <n>           Check only first N apps
--apps <list>         Check specific apps (comma-separated)
--apply               Actually apply updates
--dry-run             Preview without making changes
--patch-only          Only patch updates (1.2.3 → 1.2.4)
--minor-and-patch     Minor + patch (1.2.3 → 1.3.0)
--help                Show help message
```

## 🎯 Recommended Workflow

```bash
# 1. Check
node scripts/advanced_checker.js

# 2. Review
cat update-reports/advanced-report-*.md

# 3. Preview
node scripts/advanced_checker.js --dry-run --patch-only

# 4. Apply
node scripts/advanced_checker.js --apply --patch-only

# 5. Commit
git add public/v4/apps/
git commit -m "chore: update patch versions"
```

## 🐛 Common Issues

| Issue | Solution |
|-------|----------|
| Rate limit exceeded | Wait 1 hour for cache refresh |
| No updates found | Apps may be up to date, or cache is stale |
| Updates not applied | Check file permissions, review error messages |
| Script hangs | Normal for full scan (5-10 min), use `--limit` to test |

## 📞 Quick Help

```bash
# Test if everything is set up correctly
node scripts/test_setup.js

# Get help
node scripts/advanced_checker.js --help

# Check documentation
cat scripts/README.md
```

## 🌟 Pro Tips

1. **Use caching**: Re-runs within 1 hour use cached data (instant)
2. **Test first**: Always use `--limit 10` or `--dry-run` first
3. **Batch wisely**: Update patches weekly, minors monthly, majors quarterly
4. **Track changes**: Commit updates separately by type for easy rollback
5. **GitHub token**: Set `GITHUB_TOKEN` for enhanced checking

---

**Most important command to remember:**
```bash
node scripts/advanced_checker.js --limit 10
```
This will get you started safely!
