#!/usr/bin/env node

/**
 * Check for updates to Docker images in Caprover one-click-apps
 * 
 * This script:
 * 1. Parses all YAML files in public/v4/apps/
 * 2. Extracts Docker image references and their versions
 * 3. Queries Docker Hub API for latest versions
 * 4. Queries GitHub API for releases (when applicable)
 * 5. Generates a report of available updates
 * 6. Optionally updates the YAML files with new versions
 */

const fs = require('fs-extra');
const path = require('path');
const yaml = require('yaml');
const https = require('https');
const http = require('http');

// Configuration
const APPS_DIR = path.join(__dirname, '../public/v4/apps');
const OUTPUT_DIR = path.join(__dirname, '../update-reports');
const CACHE_DIR = path.join(__dirname, '../.version-cache');

// Rate limiting
const DOCKER_HUB_DELAY = 1000; // 1 second between requests
const GITHUB_DELAY = 1000; // 1 second between requests

// Ensure directories exist
fs.ensureDirSync(OUTPUT_DIR);
fs.ensureDirSync(CACHE_DIR);

/**
 * Make HTTP/HTTPS request with promise
 */
function makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const reqOptions = {
            headers: {
                'User-Agent': 'Caprover-Update-Checker/1.0',
                ...options.headers
            },
            ...options
        };

        protocol.get(url, reqOptions, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        resolve(data);
                    }
                } else if (res.statusCode === 404) {
                    resolve(null);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        }).on('error', reject);
    });
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse Docker image reference
 * Examples: nginx:1.21, postgres:13, bitnami/ghost:5.2.2
 */
function parseDockerImage(imageRef) {
    if (!imageRef || typeof imageRef !== 'string') {
        return null;
    }

    // Remove any variable references like $$cap_version
    if (imageRef.includes('$$cap_')) {
        return null;
    }

    const parts = imageRef.split(':');
    if (parts.length !== 2) {
        return null;
    }

    const [imageName, version] = parts;
    
    // Parse image name (may include registry and namespace)
    const imageParts = imageName.split('/');
    let registry = 'docker.io';
    let namespace = 'library';
    let repository = imageName;

    if (imageParts.length === 1) {
        // Official image: postgres
        repository = imageParts[0];
    } else if (imageParts.length === 2) {
        // Namespaced image: bitnami/ghost
        namespace = imageParts[0];
        repository = imageParts[1];
    } else if (imageParts.length >= 3) {
        // Custom registry: ghcr.io/owner/repo
        registry = imageParts[0];
        namespace = imageParts[1];
        repository = imageParts.slice(2).join('/');
    }

    return {
        full: imageRef,
        registry,
        namespace,
        repository,
        fullName: `${namespace}/${repository}`,
        currentVersion: version,
        isOfficial: namespace === 'library'
    };
}

/**
 * Extract all Docker images from a YAML app definition
 */
function extractImagesFromYaml(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const data = yaml.parse(content);
        
        const images = [];
        
        if (data.services) {
            for (const [serviceName, service] of Object.entries(data.services)) {
                if (service.image) {
                    const parsed = parseDockerImage(service.image);
                    if (parsed) {
                        images.push({
                            ...parsed,
                            serviceName,
                            file: path.basename(filePath)
                        });
                    }
                }
            }
        }
        
        return images;
    } catch (error) {
        console.error(`Error parsing ${filePath}:`, error.message);
        return [];
    }
}

/**
 * Get latest version from Docker Hub
 */
async function getDockerHubLatestVersion(namespace, repository) {
    try {
        const cacheKey = `dockerhub_${namespace}_${repository}`;
        const cacheFile = path.join(CACHE_DIR, `${cacheKey}.json`);
        
        // Check cache (valid for 1 hour)
        if (fs.existsSync(cacheFile)) {
            const stats = fs.statSync(cacheFile);
            const age = Date.now() - stats.mtimeMs;
            if (age < 3600000) { // 1 hour
                return fs.readJsonSync(cacheFile);
            }
        }

        // Docker Hub API v2
        const url = namespace === 'library' 
            ? `https://hub.docker.com/v2/repositories/library/${repository}/tags?page_size=100`
            : `https://hub.docker.com/v2/repositories/${namespace}/${repository}/tags?page_size=100`;
        
        await sleep(DOCKER_HUB_DELAY);
        const data = await makeRequest(url);
        
        if (!data || !data.results) {
            return null;
        }

        // Filter and sort versions
        const versions = data.results
            .filter(tag => {
                const name = tag.name;
                // Filter out non-version tags
                if (name === 'latest' || name === 'edge' || name === 'dev' || 
                    name === 'nightly' || name === 'canary' || name === 'alpha' || 
                    name === 'beta' || name === 'rc' || name.includes('snapshot')) {
                    return false;
                }
                return true;
            })
            .map(tag => ({
                name: tag.name,
                lastUpdated: tag.last_updated,
                digest: tag.digest
            }));

        const result = {
            versions: versions.slice(0, 10), // Keep top 10
            latestStable: versions[0]?.name || null,
            lastChecked: new Date().toISOString()
        };

        // Cache the result
        fs.writeJsonSync(cacheFile, result);
        
        return result;
    } catch (error) {
        console.error(`Error fetching Docker Hub info for ${namespace}/${repository}:`, error.message);
        return null;
    }
}

/**
 * Compare semantic versions
 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1, v2) {
    if (v1 === v2) return 0;
    
    // Remove leading 'v' if present
    v1 = v1.replace(/^v/, '');
    v2 = v2.replace(/^v/, '');
    
    // Split by dots and compare each part
    const parts1 = v1.split(/[.-]/).map(p => parseInt(p) || p);
    const parts2 = v2.split(/[.-]/).map(p => parseInt(p) || p);
    
    const maxLen = Math.max(parts1.length, parts2.length);
    
    for (let i = 0; i < maxLen; i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        
        if (typeof p1 === 'number' && typeof p2 === 'number') {
            if (p1 > p2) return 1;
            if (p1 < p2) return -1;
        } else {
            const str1 = String(p1);
            const str2 = String(p2);
            if (str1 > str2) return 1;
            if (str1 < str2) return -1;
        }
    }
    
    return 0;
}

/**
 * Detect if there's an update available
 */
function detectUpdate(currentVersion, latestVersion) {
    if (!latestVersion) return null;
    
    try {
        const comparison = compareVersions(latestVersion, currentVersion);
        if (comparison > 0) {
            return {
                hasUpdate: true,
                currentVersion,
                latestVersion,
                updateType: determineUpdateType(currentVersion, latestVersion)
            };
        }
    } catch (error) {
        // Version comparison failed, return uncertain
        return null;
    }
    
    return {
        hasUpdate: false,
        currentVersion,
        latestVersion
    };
}

/**
 * Determine update type (major, minor, patch)
 */
function determineUpdateType(current, latest) {
    const currentParts = current.replace(/^v/, '').split(/[.-]/).map(p => parseInt(p) || 0);
    const latestParts = latest.replace(/^v/, '').split(/[.-]/).map(p => parseInt(p) || 0);
    
    if (latestParts[0] > currentParts[0]) return 'major';
    if (latestParts[1] > currentParts[1]) return 'minor';
    if (latestParts[2] > currentParts[2]) return 'patch';
    
    return 'other';
}

/**
 * Process all apps and check for updates
 */
async function checkAllApps(options = {}) {
    const { applyUpdates = false, specificApps = [] } = options;
    
    console.log('🔍 Scanning for one-click apps...\n');
    
    const files = fs.readdirSync(APPS_DIR)
        .filter(f => f.endsWith('.yml'))
        .filter(f => specificApps.length === 0 || specificApps.includes(f));
    
    console.log(`Found ${files.length} app definition(s)\n`);
    
    const results = [];
    let processedCount = 0;
    
    for (const file of files) {
        const filePath = path.join(APPS_DIR, file);
        const images = extractImagesFromYaml(filePath);
        
        if (images.length === 0) {
            continue;
        }
        
        console.log(`📦 Processing: ${file}`);
        
        for (const image of images) {
            console.log(`  ⏳ Checking ${image.fullName}:${image.currentVersion}...`);
            
            const dockerHubInfo = await getDockerHubLatestVersion(image.namespace, image.repository);
            
            if (dockerHubInfo && dockerHubInfo.latestStable) {
                const updateInfo = detectUpdate(image.currentVersion, dockerHubInfo.latestStable);
                
                if (updateInfo && updateInfo.hasUpdate) {
                    console.log(`  ✅ Update available: ${image.currentVersion} → ${dockerHubInfo.latestStable} (${updateInfo.updateType})`);
                    results.push({
                        file,
                        image: image.fullName,
                        serviceName: image.serviceName,
                        currentVersion: image.currentVersion,
                        latestVersion: dockerHubInfo.latestStable,
                        updateType: updateInfo.updateType,
                        allVersions: dockerHubInfo.versions.map(v => v.name)
                    });
                } else {
                    console.log(`  ✓ Up to date: ${image.currentVersion}`);
                }
            } else {
                console.log(`  ⚠️  Could not fetch version info`);
            }
        }
        
        processedCount++;
        console.log('');
    }
    
    // Generate report
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(OUTPUT_DIR, `update-report-${timestamp}.json`);
    const report = {
        timestamp: new Date().toISOString(),
        totalAppsChecked: processedCount,
        totalUpdatesAvailable: results.length,
        updates: results,
        summary: {
            major: results.filter(r => r.updateType === 'major').length,
            minor: results.filter(r => r.updateType === 'minor').length,
            patch: results.filter(r => r.updateType === 'patch').length,
            other: results.filter(r => r.updateType === 'other').length
        }
    };
    
    fs.writeJsonSync(reportPath, report, { spaces: 2 });
    
    // Generate markdown report
    const mdReportPath = path.join(OUTPUT_DIR, `update-report-${timestamp}.md`);
    const mdReport = generateMarkdownReport(report);
    fs.writeFileSync(mdReportPath, mdReport);
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 SUMMARY');
    console.log('='.repeat(80));
    console.log(`Apps checked: ${processedCount}`);
    console.log(`Updates available: ${results.length}`);
    console.log(`  - Major updates: ${report.summary.major}`);
    console.log(`  - Minor updates: ${report.summary.minor}`);
    console.log(`  - Patch updates: ${report.summary.patch}`);
    console.log(`\nReports saved to:`);
    console.log(`  - JSON: ${reportPath}`);
    console.log(`  - Markdown: ${mdReportPath}`);
    
    return report;
}

/**
 * Generate markdown report
 */
function generateMarkdownReport(report) {
    let md = `# Caprover One-Click Apps - Update Report\n\n`;
    md += `**Generated:** ${report.timestamp}\n\n`;
    md += `## Summary\n\n`;
    md += `- **Apps Checked:** ${report.totalAppsChecked}\n`;
    md += `- **Updates Available:** ${report.totalUpdatesAvailable}\n`;
    md += `  - Major updates: ${report.summary.major}\n`;
    md += `  - Minor updates: ${report.summary.minor}\n`;
    md += `  - Patch updates: ${report.summary.patch}\n\n`;
    
    if (report.updates.length === 0) {
        md += `✅ All apps are up to date!\n`;
        return md;
    }
    
    md += `## Available Updates\n\n`;
    
    // Group by update type
    const byType = {
        major: report.updates.filter(u => u.updateType === 'major'),
        minor: report.updates.filter(u => u.updateType === 'minor'),
        patch: report.updates.filter(u => u.updateType === 'patch'),
        other: report.updates.filter(u => u.updateType === 'other')
    };
    
    for (const [type, updates] of Object.entries(byType)) {
        if (updates.length === 0) continue;
        
        const emoji = type === 'major' ? '🔴' : type === 'minor' ? '🟡' : '🟢';
        md += `### ${emoji} ${type.charAt(0).toUpperCase() + type.slice(1)} Updates (${updates.length})\n\n`;
        md += `| App | Service | Image | Current | Latest |\n`;
        md += `|-----|---------|-------|---------|--------|\n`;
        
        for (const update of updates) {
            md += `| ${update.file} | ${update.serviceName} | ${update.image} | ${update.currentVersion} | ${update.latestVersion} |\n`;
        }
        md += `\n`;
    }
    
    return md;
}

/**
 * Update YAML file with new version
 */
async function updateYamlFile(file, serviceName, oldVersion, newVersion) {
    const filePath = path.join(APPS_DIR, file);
    
    try {
        let content = fs.readFileSync(filePath, 'utf8');
        
        // Replace the version in the image reference
        const oldImagePattern = new RegExp(`(image:\\s*[^:]+):${oldVersion.replace(/\./g, '\\.')}`, 'g');
        const newContent = content.replace(oldImagePattern, `$1:${newVersion}`);
        
        // Also update defaultValue if it matches the old version
        const oldDefaultPattern = new RegExp(`(defaultValue:\\s*['"]?)${oldVersion.replace(/\./g, '\\.')}(['"]?)`, 'g');
        const updatedContent = newContent.replace(oldDefaultPattern, `$1${newVersion}$2`);
        
        if (content !== updatedContent) {
            fs.writeFileSync(filePath, updatedContent);
            console.log(`  ✅ Updated ${file}`);
            return true;
        } else {
            console.log(`  ⚠️  No changes made to ${file}`);
            return false;
        }
    } catch (error) {
        console.error(`  ❌ Error updating ${file}:`, error.message);
        return false;
    }
}

/**
 * Apply updates based on report
 */
async function applyUpdates(report, options = {}) {
    const { updateTypes = ['patch', 'minor', 'major'], dryRun = false } = options;
    
    console.log('\n' + '='.repeat(80));
    console.log('🔧 APPLYING UPDATES');
    console.log('='.repeat(80));
    console.log(`Update types: ${updateTypes.join(', ')}`);
    console.log(`Dry run: ${dryRun ? 'Yes' : 'No'}\n`);
    
    const updatesToApply = report.updates.filter(u => updateTypes.includes(u.updateType));
    
    if (updatesToApply.length === 0) {
        console.log('No updates to apply with the specified criteria.');
        return;
    }
    
    console.log(`Found ${updatesToApply.length} update(s) to apply\n`);
    
    let successCount = 0;
    
    for (const update of updatesToApply) {
        console.log(`📝 ${update.file} - ${update.image}: ${update.currentVersion} → ${update.latestVersion}`);
        
        if (!dryRun) {
            const success = await updateYamlFile(
                update.file,
                update.serviceName,
                update.currentVersion,
                update.latestVersion
            );
            if (success) successCount++;
        } else {
            console.log(`  [DRY RUN] Would update ${update.file}`);
        }
    }
    
    console.log(`\n✅ Applied ${successCount} update(s)`);
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    
    const options = {
        applyUpdates: args.includes('--apply'),
        dryRun: args.includes('--dry-run'),
        patchOnly: args.includes('--patch-only'),
        minorAndPatch: args.includes('--minor-and-patch'),
        specificApps: []
    };
    
    // Extract specific apps
    const appIndex = args.indexOf('--apps');
    if (appIndex !== -1 && args[appIndex + 1]) {
        options.specificApps = args[appIndex + 1].split(',');
    }
    
    console.log('🚀 Caprover One-Click Apps Update Checker\n');
    
    // Check for updates
    const report = await checkAllApps(options);
    
    // Apply updates if requested
    if (options.applyUpdates || options.dryRun) {
        let updateTypes = ['major', 'minor', 'patch', 'other'];
        
        if (options.patchOnly) {
            updateTypes = ['patch'];
        } else if (options.minorAndPatch) {
            updateTypes = ['minor', 'patch'];
        }
        
        await applyUpdates(report, {
            updateTypes,
            dryRun: options.dryRun
        });
    }
    
    console.log('\n✨ Done!\n');
}

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = {
    checkAllApps,
    applyUpdates,
    parseDockerImage,
    compareVersions,
    detectUpdate,
    getDockerHubLatestVersion
};
