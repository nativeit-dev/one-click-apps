# Caprover One-Click Apps - Update Checker

Automated tool to check for updates to Docker images in Caprover one-click-app templates and optionally update them.

## Features

- ✅ **Automatic Version Detection**: Scans all YAML app definitions and extracts Docker image versions
- ✅ **Docker Hub Integration**: Queries Docker Hub API for latest versions
- ✅ **Semantic Version Comparison**: Intelligently compares versions and detects update types (major, minor, patch)
- ✅ **Update Reports**: Generates detailed JSON and Markdown reports
- ✅ **Batch Updates**: Can automatically update multiple apps at once
- ✅ **Smart Filtering**: Update only patch, minor, or all versions
- ✅ **Caching**: Caches API responses to avoid rate limiting
- ✅ **Dry Run Mode**: Preview changes before applying them

## Installation

No additional installation required beyond the existing project dependencies:

```bash
npm install
```

## Usage

### Check for Updates (Report Only)

Check all apps and generate a report without making changes:

```bash
node scripts/check_updates.js
```

### Check Specific Apps

Check only specific apps:

```bash
node scripts/check_updates.js --apps wordpress.yml,gitea.yml,ghost.yml
```

### Dry Run (Preview Updates)

See what would be updated without making actual changes:

```bash
node scripts/check_updates.js --dry-run
```

### Apply Patch Updates Only

Apply only patch-level updates (safest):

```bash
node scripts/check_updates.js --apply --patch-only
```

### Apply Minor and Patch Updates

Apply minor and patch updates (moderate risk):

```bash
node scripts/check_updates.js --apply --minor-and-patch
```

### Apply All Updates

Apply all updates including major versions (use with caution):

```bash
node scripts/check_updates.js --apply
```

### Dry Run with Patch Filter

Preview what patch updates would be applied:

```bash
node scripts/check_updates.js --dry-run --patch-only
```

## Command Line Options

| Option | Description |
|--------|-------------|
| `--apply` | Actually apply the updates to YAML files |
| `--dry-run` | Show what would be updated without making changes |
| `--patch-only` | Only update patch versions (e.g., 1.2.3 → 1.2.4) |
| `--minor-and-patch` | Update minor and patch versions (e.g., 1.2.x → 1.3.x) |
| `--apps <list>` | Check specific apps (comma-separated, e.g., `wordpress.yml,gitea.yml`) |

## Output

### Reports Directory

All reports are saved to `update-reports/` with timestamps:

- **JSON Report**: `update-report-YYYY-MM-DDTHH-MM-SS.json` - Detailed machine-readable report
- **Markdown Report**: `update-report-YYYY-MM-DDTHH-MM-SS.md` - Human-readable summary

### Report Structure

JSON report includes:

```json
{
  "timestamp": "2025-12-02T10:30:00.000Z",
  "totalAppsChecked": 344,
  "totalUpdatesAvailable": 42,
  "updates": [
    {
      "file": "wordpress.yml",
      "image": "library/wordpress",
      "serviceName": "$$cap_appname-wordpress",
      "currentVersion": "6.7.0",
      "latestVersion": "6.7.1",
      "updateType": "patch",
      "allVersions": ["6.7.1", "6.7.0", "6.6.2", ...]
    }
  ],
  "summary": {
    "major": 5,
    "minor": 15,
    "patch": 22,
    "other": 0
  }
}
```

### Console Output

The script provides real-time progress updates:

```
🔍 Scanning for one-click apps...

Found 344 app definition(s)

📦 Processing: wordpress.yml
  ⏳ Checking library/wordpress:6.7.0...
  ✅ Update available: 6.7.0 → 6.7.1 (patch)
  ⏳ Checking library/mysql:8.4.2...
  ✓ Up to date: 8.4.2

================================================================================
📊 SUMMARY
================================================================================
Apps checked: 344
Updates available: 42
  - Major updates: 5
  - Minor updates: 15
  - Patch updates: 22

Reports saved to:
  - JSON: update-reports/update-report-2025-12-02T10-30-00.json
  - Markdown: update-reports/update-report-2025-12-02T10-30-00.md

✨ Done!
```

## How It Works

### 1. Image Extraction

The script parses each YAML file and extracts Docker image references:

```yaml
services:
  $$cap_appname:
    image: wordpress:6.7.0  # Extracted: wordpress:6.7.0
```

### 2. Version Detection

Images are parsed into components:
- **Registry**: `docker.io` (default)
- **Namespace**: `library` (official), `bitnami`, etc.
- **Repository**: `wordpress`, `ghost`, etc.
- **Version**: `6.7.0`

### 3. Docker Hub Query

Queries Docker Hub API:
```
https://hub.docker.com/v2/repositories/{namespace}/{repository}/tags
```

Filters out non-version tags (`latest`, `edge`, `dev`, `nightly`, etc.)

### 4. Version Comparison

Uses semantic versioning to compare:
- Splits versions by dots: `6.7.1` → `[6, 7, 1]`
- Compares each segment numerically
- Determines update type (major, minor, patch)

### 5. Update Application

When `--apply` is used, the script:
1. Reads the YAML file
2. Replaces old version with new version using regex
3. Updates both `image:` and `defaultValue:` fields
4. Writes back to file

## Caching

API responses are cached in `.version-cache/` for 1 hour to:
- Avoid Docker Hub rate limiting (100 requests per 6 hours for anonymous users)
- Speed up repeated runs
- Allow offline re-runs with cached data

Cache files: `.version-cache/dockerhub_{namespace}_{repository}.json`

## Best Practices

### 🟢 Safe Updates (Recommended)

```bash
# 1. Check for updates first
node scripts/check_updates.js

# 2. Review the generated report
cat update-reports/update-report-*.md

# 3. Apply patch updates only
node scripts/check_updates.js --apply --patch-only

# 4. Test the updated apps in a staging environment

# 5. Apply minor updates if needed
node scripts/check_updates.js --apply --minor-and-patch
```

### 🟡 Moderate Risk

```bash
# Apply minor and patch updates
node scripts/check_updates.js --apply --minor-and-patch
```

### 🔴 High Risk

```bash
# Apply all updates including major versions
# Major version updates may include breaking changes!
node scripts/check_updates.js --apply
```

## Limitations

### Currently Supported
- ✅ Docker Hub images (official and community)
- ✅ Semantic versioning (1.2.3 format)
- ✅ Hardcoded versions in YAML

### Not Yet Supported
- ⚠️ Images with template variables (e.g., `image: app:$$cap_version`)
- ⚠️ GitHub Container Registry (ghcr.io) - API not yet implemented
- ⚠️ Private registries
- ⚠️ Custom version formats (date-based, commit hashes)
- ⚠️ GitHub releases as source of truth

## Troubleshooting

### Rate Limiting

If you hit Docker Hub rate limits:

1. **Use authentication** (not yet implemented):
   ```bash
   export DOCKER_HUB_USERNAME="your-username"
   export DOCKER_HUB_TOKEN="your-token"
   ```

2. **Use cached data**:
   Cache is valid for 1 hour, so wait and re-run

3. **Check specific apps**:
   ```bash
   node scripts/check_updates.js --apps wordpress.yml,ghost.yml
   ```

### Version Not Found

Some images may not be found if:
- The image is from a private registry
- The namespace/repository name is incorrect
- The Docker Hub API is down

### Updates Not Applied

If `--apply` doesn't work:
- Check file permissions
- Ensure the YAML format is valid
- Review the console output for error messages

## Contributing

To add support for:
- **GitHub Container Registry**: Implement `getGhcrLatestVersion()` function
- **GitHub Releases**: Implement `getGithubReleaseVersion()` function  
- **Custom registries**: Add registry detection and API implementations

## Examples

### Example 1: Weekly Update Routine

```bash
#!/bin/bash
# weekly-update.sh

# Step 1: Check for updates
node scripts/check_updates.js

# Step 2: Apply safe patch updates
node scripts/check_updates.js --apply --patch-only

# Step 3: Commit changes
git add public/v4/apps/
git commit -m "chore: update apps with patch versions"

# Step 4: Create PR
git push origin HEAD:update-$(date +%Y%m%d)
```

### Example 2: Selective Updates

```bash
# Update only database-related apps
node scripts/check_updates.js \
  --apps postgres.yml,mysql.yml,mongodb.yml,redis.yml \
  --apply \
  --minor-and-patch
```

### Example 3: Pre-release Check

```bash
# Before a major release, check everything
node scripts/check_updates.js > update-check.log

# Review the report
cat update-reports/update-report-*.md

# Apply updates in stages
node scripts/check_updates.js --apply --patch-only
# Test...
node scripts/check_updates.js --apply --minor-and-patch
# Test...
```

## License

Same as the parent project (ISC)

## Support

For issues or questions:
1. Check existing issues in the repository
2. Review the generated reports for detailed information
3. Check Docker Hub manually for the specific image
4. Create a new issue with the error message and app name
