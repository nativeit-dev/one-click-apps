# Caprover One-Click Apps - Update Tools

This directory contains automated tools to check for and apply updates to Docker images in Caprover one-click-app templates.

## 📋 Available Scripts

### 1. `advanced_checker.js` (RECOMMENDED)
**The most comprehensive solution** - Handles template variables and resolves versions from default values.

```bash
# Quick test (first 10 apps)
node scripts/advanced_checker.js --limit 10

# Check all apps
node scripts/advanced_checker.js

# Check specific apps
node scripts/advanced_checker.js --apps wordpress.yml,gitea.yml,ghost.yml

# Preview patch updates (no changes)
node scripts/advanced_checker.js --dry-run --patch-only

# Apply patch updates only (safest)
node scripts/advanced_checker.js --apply --patch-only

# Apply minor and patch updates
node scripts/advanced_checker.js --apply --minor-and-patch
```

**Features:**
- ✅ Handles template variables (`$$cap_version`)
- ✅ Resolves versions from `defaultValue` fields
- ✅ Checks Docker Hub for latest versions
- ✅ Smart version comparison
- ✅ Update type detection (major/minor/patch)
- ✅ Detailed JSON and Markdown reports
- ✅ Batch update capability

### 2. `enhanced_checker.js`
Combines Docker Hub + GitHub Releases for comprehensive checking.

```bash
# Check with both Docker Hub and GitHub
node scripts/enhanced_checker.js

# Docker Hub only (faster)
node scripts/enhanced_checker.js --no-github

# With GitHub token for higher rate limit
GITHUB_TOKEN=ghp_xxx node scripts/enhanced_checker.js
```

**Features:**
- ✅ Docker Hub API integration
- ✅ GitHub Releases API integration  
- ✅ Cross-reference versions from both sources
- ✅ Identifies version mismatches
- ⚠️ Requires GitHub token for large-scale checks

### 3. `check_updates.js`
Basic version - only handles hardcoded image versions.

```bash
# Basic check
node scripts/check_updates.js

# Specific apps
node scripts/check_updates.js --apps gitea.yml
```

**Limitations:**
- ⚠️ Cannot handle template variables
- ⚠️ Only works with hardcoded versions like `image: postgres:13`

### 4. `github_checker.js`
GitHub Releases checker utility.

```bash
# Test GitHub API access
node scripts/github_checker.js --test

# Check specific image
node scripts/github_checker.js --image gitea/gitea:1.21.1

# Check specific repo
node scripts/github_checker.js --repo go-gitea/gitea
```

## 🚀 Quick Start

**Recommended workflow for updating apps:**

```bash
# Step 1: Check what's available (first 10 apps for testing)
node scripts/advanced_checker.js --limit 10

# Step 2: Check all apps
node scripts/advanced_checker.js

# Step 3: Review the generated report
cat update-reports/advanced-report-*.md

# Step 4: Preview patch updates
node scripts/advanced_checker.js --dry-run --patch-only

# Step 5: Apply patch updates
node scripts/advanced_checker.js --apply --patch-only

# Step 6: Test the updated apps

# Step 7: Apply minor updates if desired
node scripts/advanced_checker.js --apply --minor-and-patch

# Step 8: Commit changes
git add public/v4/apps/
git commit -m "chore: update app versions"
```

## 📊 Understanding Reports

### Report Locations
All reports are saved to `update-reports/` with timestamps:
- `advanced-report-YYYY-MM-DDTHH-MM-SS.json` - Machine-readable
- `advanced-report-YYYY-MM-DDTHH-MM-SS.md` - Human-readable

### Update Types

| Type | Description | Example | Risk |
|------|-------------|---------|------|
| 🟢 **Patch** | Bug fixes, security patches | 1.2.3 → 1.2.4 | Low |
| 🟡 **Minor** | New features, backwards compatible | 1.2.3 → 1.3.0 | Medium |
| 🔴 **Major** | Breaking changes | 1.2.3 → 2.0.0 | High |

### Example Report Output

```
📦 WordPress (wordpress.yml)
  🔎 library/wordpress:6.7.0
    📝 Resolved from template: wordpress:$$cap_wp_version
    ✅ Update available: 6.7.0 → 6.7.1 (patch)
  🔎 library/mysql:8.4.2
    📝 Resolved from template: mysql:$$cap_database_version
    ✓ Up to date: 8.4.2

================================================================================
📊 SUMMARY
================================================================================
Files scanned: 344
Apps checked: 320
Apps skipped: 24 (no parseable images)
Updates available: 87
  - Major updates: 12
  - Minor updates: 35
  - Patch updates: 40
```

## 🔧 Configuration

### Environment Variables

```bash
# GitHub Personal Access Token (optional, increases rate limit)
export GITHUB_TOKEN=ghp_your_token_here
```

### Cache Directory
API responses are cached in `.version-cache/` for 1 hour to avoid rate limiting.

## 📈 Rate Limits

### Docker Hub
- **Anonymous**: 100 requests per 6 hours per IP
- **Authenticated**: Not yet implemented
- **Solution**: Caching (automatic)

### GitHub
- **Anonymous**: 60 requests per hour per IP
- **Authenticated**: 5,000 requests per hour
- **Solution**: Set `GITHUB_TOKEN` environment variable

## 🛡️ Safety Recommendations

### ✅ Always Safe
```bash
# Check only, no changes
node scripts/advanced_checker.js

# Dry run to preview
node scripts/advanced_checker.js --dry-run
```

### 🟢 Generally Safe
```bash
# Patch updates only
node scripts/advanced_checker.js --apply --patch-only
```

### 🟡 Use with Caution
```bash
# Minor and patch updates
node scripts/advanced_checker.js --apply --minor-and-patch

# Always test in staging first!
```

### 🔴 High Risk
```bash
# All updates including major versions
node scripts/advanced_checker.js --apply

# Major version updates may have breaking changes!
# Review changelog for each app before applying
```

## 📝 Examples

### Example 1: Check Database Apps
```bash
node scripts/advanced_checker.js \
  --apps postgres.yml,mysql.yml,mongodb.yml,redis.yml,mariadb.yml
```

### Example 2: Weekly Update Routine
```bash
#!/bin/bash
# weekly-update.sh

# Generate report
node scripts/advanced_checker.js

# Email or review the report
cat update-reports/advanced-report-*.md | mail -s "Weekly Update Report" admin@example.com

# Apply safe updates
node scripts/advanced_checker.js --apply --patch-only

# Commit if successful
git add public/v4/apps/
git commit -m "chore: weekly patch updates $(date +%Y-%m-%d)"
git push
```

### Example 3: Pre-Release Check
```bash
# Before a major release, check everything
node scripts/advanced_checker.js > update-check.log

# Review the markdown report
code update-reports/advanced-report-*.md

# Apply updates in stages
node scripts/advanced_checker.js --apply --patch-only
# ... test ...
node scripts/advanced_checker.js --apply --minor-and-patch
# ... test ...
```

### Example 4: Continuous Integration
```yaml
# .github/workflows/check-updates.yml
name: Check for Updates
on:
  schedule:
    - cron: '0 0 * * 1'  # Weekly on Monday
  workflow_dispatch:

jobs:
  check-updates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm install
      
      - name: Check for updates
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: node scripts/advanced_checker.js
      
      - name: Upload report
        uses: actions/upload-artifact@v3
        with:
          name: update-report
          path: update-reports/
      
      - name: Create issue if updates available
        if: success()
        uses: actions/github-script@v6
        with:
          script: |
            const fs = require('fs');
            const reports = fs.readdirSync('update-reports');
            const latestMd = reports.filter(f => f.endsWith('.md')).sort().pop();
            const content = fs.readFileSync(`update-reports/${latestMd}`, 'utf8');
            
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: `Weekly Update Report - ${new Date().toISOString().split('T')[0]}`,
              body: content
            });
```

## 🐛 Troubleshooting

### Issue: "Could not fetch version info"
**Causes:**
- Rate limit exceeded (Docker Hub or GitHub)
- Image not found on Docker Hub
- Network issues

**Solutions:**
1. Wait 1 hour for cache to expire
2. Set `GITHUB_TOKEN` for GitHub checks
3. Check if image exists on Docker Hub manually
4. Use `--limit 10` to test with fewer apps

### Issue: "No changes made to file"
**Causes:**
- Version already up to date
- Version format doesn't match pattern
- File uses complex template logic

**Solutions:**
1. Check the report to confirm update is available
2. Manually inspect the YAML file
3. Update manually if pattern is complex

### Issue: Script hangs or is very slow
**Causes:**
- Checking all 344 apps takes 5-10 minutes
- Docker Hub rate limiting adds delays
- Network latency

**Solutions:**
1. Use `--limit 10` for testing
2. Use `--apps` to check specific apps
3. Cached results are returned instantly

## 📚 Additional Documentation

- `UPDATE_CHECKER_README.md` - Detailed documentation for the basic checker
- `enhanced_checker.js` - Source code with inline documentation
- `advanced_checker.js` - Source code with inline documentation

## 🤝 Contributing

To add support for:
- **Custom registries**: Implement registry detection in `parseDockerImage()`
- **Alternative version sources**: Add new checker functions
- **Better version parsing**: Improve `compareVersions()` function
- **Automated PR creation**: Integrate with GitHub API

## 📄 License

Same as the parent project (ISC)
