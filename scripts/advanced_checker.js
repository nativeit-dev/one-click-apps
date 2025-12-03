#!/usr/bin/env node

/**
 * Advanced Update Checker - Handles Template Variables
 * 
 * This version can handle YAML files that use template variables
 * by extracting the default values and using them for version checking.
 */

const fs = require('fs-extra');
const path = require('path');
const yaml = require('yaml');
const https = require('https');

const APPS_DIR = path.join(__dirname, '../public/v4/apps');
const OUTPUT_DIR = path.join(__dirname, '../update-reports');
const CACHE_DIR = path.join(__dirname, '../.version-cache');

fs.ensureDirSync(OUTPUT_DIR);
fs.ensureDirSync(CACHE_DIR);

const DOCKER_HUB_DELAY = 1000;

/**
 * Make HTTP/HTTPS request with promise
 */
function makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : require('http');
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

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extract app configuration including template variables
 */
function extractAppConfig(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const data = yaml.parse(content);
        
        if (!data.services) {
            return null;
        }
        
        // Build variable map from defaults
        const variables = {};
        if (data.caproverOneClickApp && data.caproverOneClickApp.variables) {
            for (const variable of data.caproverOneClickApp.variables) {
                if (variable.id && variable.defaultValue) {
                    variables[variable.id] = variable.defaultValue;
                }
            }
        }
        
        // Extract services and resolve template variables
        const services = [];
        const appBaseName = path.basename(filePath, '.yml');
        
        for (const [serviceName, service] of Object.entries(data.services)) {
            if (!service.image) continue;
            
            // Only process main app service ($$cap_appname or $$cap_appname-<appname>)
            // Skip dependency services like databases, redis, etc.
            const isMainService = serviceName === '$$cap_appname' || 
                                 serviceName === `$$cap_appname-${appBaseName}`;
            
            if (!isMainService) {
                continue;
            }
            
            const imageRef = service.image;
            let resolvedImage = imageRef;
            
            // Check if image contains template variables (any $$ prefix)
            const hasVariables = imageRef.includes('$$');
            
            if (hasVariables) {
                // Try to resolve variables
                resolvedImage = imageRef;
                for (const [varName, varValue] of Object.entries(variables)) {
                    resolvedImage = resolvedImage.replace(varName, varValue);
                }
                
                // If still has unresolved variables, skip
                if (resolvedImage.includes('$$')) {
                    continue;
                }
            }
            
            // Parse resolved image
            const parsed = parseDockerImage(resolvedImage);
            if (!parsed) continue;
            
            services.push({
                serviceName,
                originalImage: imageRef,
                resolvedImage,
                hasVariables,
                ...parsed
            });
        }
        
        return {
            file: path.basename(filePath),
            filePath,
            services,
            variables,
            displayName: data.caproverOneClickApp?.displayName || path.basename(filePath, '.yml')
        };
        
    } catch (error) {
        console.error(`Error parsing ${filePath}:`, error.message);
        return null;
    }
}

/**
 * Parse Docker image reference
 */
function parseDockerImage(imageRef) {
    if (!imageRef || typeof imageRef !== 'string') {
        return null;
    }

    if (imageRef.includes('$$cap_')) {
        return null;
    }

    const parts = imageRef.split(':');
    if (parts.length !== 2) {
        return null;
    }

    const [imageName, version] = parts;
    
    const imageParts = imageName.split('/');
    let registry = 'docker.io';
    let namespace = 'library';
    let repository = imageName;

    if (imageParts.length === 1) {
        repository = imageParts[0];
    } else if (imageParts.length === 2) {
        namespace = imageParts[0];
        repository = imageParts[1];
    } else if (imageParts.length >= 3) {
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
 * Get latest version from Docker Hub
 */
async function getDockerHubLatestVersion(namespace, repository) {
    try {
        const cacheKey = `dockerhub_${namespace}_${repository}`;
        const cacheFile = path.join(CACHE_DIR, `${cacheKey}.json`);
        
        if (fs.existsSync(cacheFile)) {
            const stats = fs.statSync(cacheFile);
            const age = Date.now() - stats.mtimeMs;
            if (age < 3600000) {
                return fs.readJsonSync(cacheFile);
            }
        }

        const url = namespace === 'library' 
            ? `https://hub.docker.com/v2/repositories/library/${repository}/tags?page_size=100`
            : `https://hub.docker.com/v2/repositories/${namespace}/${repository}/tags?page_size=100`;
        
        await sleep(DOCKER_HUB_DELAY);
        const data = await makeRequest(url);
        
        if (!data || !data.results) {
            return null;
        }

        const versions = data.results
            .filter(tag => {
                const name = tag.name;
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
            versions: versions.slice(0, 10),
            latestStable: versions[0]?.name || null,
            lastChecked: new Date().toISOString()
        };

        fs.writeJsonSync(cacheFile, result);
        
        return result;
    } catch (error) {
        console.error(`Error fetching Docker Hub info for ${namespace}/${repository}:`, error.message);
        return null;
    }
}

/**
 * Compare semantic versions
 */
function compareVersions(v1, v2) {
    if (v1 === v2) return 0;
    
    v1 = v1.replace(/^v/, '');
    v2 = v2.replace(/^v/, '');
    
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
 * Determine update type
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
        return null;
    }
    
    return {
        hasUpdate: false,
        currentVersion,
        latestVersion
    };
}

/**
 * Check all apps for updates
 */
async function checkAllApps(options = {}) {
    const { specificApps = [], limit = null } = options;
    
    console.log('🚀 Advanced Update Checker (Template-aware)\n');
    console.log('🔍 Scanning for one-click apps...\n');
    
    const files = fs.readdirSync(APPS_DIR)
        .filter(f => f.endsWith('.yml'))
        .filter(f => specificApps.length === 0 || specificApps.includes(f));
    
    const fileList = limit ? files.slice(0, limit) : files;
    
    console.log(`Found ${fileList.length} app definition(s) to check\n`);
    
    const results = [];
    let processedCount = 0;
    let skippedCount = 0;
    
    for (const file of fileList) {
        const filePath = path.join(APPS_DIR, file);
        const appConfig = extractAppConfig(filePath);
        
        if (!appConfig || appConfig.services.length === 0) {
            skippedCount++;
            continue;
        }
        
        console.log(`📦 ${appConfig.displayName} (${file})`);
        
        for (const service of appConfig.services) {
            console.log(`  🔎 ${service.fullName}:${service.currentVersion}`);
            
            if (service.hasVariables) {
                console.log(`    📝Resolved from template: $ {service.originalImage}`);
            }
            
            const dockerHubInfo = await getDockerHubLatestVersion(service.namespace, service.repository);
            
            if (dockerHubInfo && dockerHubInfo.latestStable) {
                const comparison = compareVersions(dockerHubInfo.latestStable, service.currentVersion);
                
                if (comparison > 0) {
                    const updateType = determineUpdateType(service.currentVersion, dockerHubInfo.latestStable);
                    console.log(`    ✅ Update available: ${service.currentVersion} → ${dockerHubInfo.latestStable} (${updateType})`);
                    
                    results.push({
                        file,
                        displayName: appConfig.displayName,
                        serviceName: service.serviceName,
                        image: service.fullName,
                        imageReference: service.originalImage,
                        hasVariables: service.hasVariables,
                        currentVersion: service.currentVersion,
                        latestVersion: dockerHubInfo.latestStable,
                        updateType,
                        allVersions: dockerHubInfo.versions.map(v => v.name)
                    });
                } else {
                    console.log(`    ✓ Up to date: ${service.currentVersion}`);
                }
            } else {
                console.log(`    ⚠️  Could not fetch version info`);
            }
        }
        
        processedCount++;
        console.log('');
    }
    
    // Generate report
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(OUTPUT_DIR, `advanced-report-${timestamp}.json`);
    const report = {
        timestamp: new Date().toISOString(),
        totalFiles: fileList.length,
        appsChecked: processedCount,
        appsSkipped: skippedCount,
        totalUpdatesAvailable: results.length,
        updates: results,
        summary: {
            major: results.filter(r => r.updateType === 'major').length,
            minor: results.filter(r => r.updateType === 'minor').length,
            patch: results.filter(r => r.updateType === 'patch').length,
            other: results.filter(r => r.updateType === 'other').length
        },
        byApp: {}
    };
    
    // Group updates by app
    for (const update of results) {
        if (!report.byApp[update.file]) {
            report.byApp[update.file] = [];
        }
        report.byApp[update.file].push(update);
    }
    
    fs.writeJsonSync(reportPath, report, { spaces: 2 });
    
    // Generate markdown report
    const mdReportPath = path.join(OUTPUT_DIR, `advanced-report-${timestamp}.md`);
    const mdReport = generateMarkdownReport(report);
    fs.writeFileSync(mdReportPath, mdReport);
    
    console.log('='.repeat(80));
    console.log('📊 SUMMARY');
    console.log('='.repeat(80));
    console.log(`Files scanned: ${fileList.length}`);
    console.log(`Apps checked: ${processedCount}`);
    console.log(`Apps skipped: ${skippedCount} (no parseable images)`);
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
    let md = `# Caprover Apps - Advanced Update Report\n\n`;
    md += `**Generated:** ${report.timestamp}\n\n`;
    md += `## Summary\n\n`;
    md += `- **Files Scanned:** ${report.totalFiles}\n`;
    md += `- **Apps Checked:** ${report.appsChecked}\n`;
    md += `- **Apps Skipped:** ${report.appsSkipped}\n`;
    md += `- **Updates Available:** ${report.totalUpdatesAvailable}\n`;
    md += `  - Major updates: ${report.summary.major}\n`;
    md += `  - Minor updates: ${report.summary.minor}\n`;
    md += `  - Patch updates: ${report.summary.patch}\n\n`;
    
    if (report.updates.length === 0) {
        md += `✅ All apps are up to date!\n`;
        return md;
    }
    
    md += `## Available Updates\n\n`;
    
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
        md += `| App | Image | Current | Latest | Template |\n`;
        md += `|-----|-------|---------|--------|----------|\n`;
        
        for (const update of updates) {
            const template = update.hasVariables ? '✓' : '';
            md += `| ${update.displayName} | ${update.image} | ${update.currentVersion} | ${update.latestVersion} | ${template} |\n`;
        }
        md += `\n`;
    }
    
    return md;
}

/**
 * Update YAML files with new versions
 */
async function applyUpdates(report, options = {}) {
    const { updateTypes = ['patch'], dryRun = false } = options;
    
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
            const filePath = path.join(APPS_DIR, update.file);
            
            try {
                let content = fs.readFileSync(filePath, 'utf8');
                
                // Replace version in defaultValue field
                const oldDefaultPattern = new RegExp(
                    `(defaultValue:\\s*['"]?)${update.currentVersion.replace(/\./g, '\\.')}(['"]?)`,
                    'g'
                );
                content = content.replace(oldDefaultPattern, `$1${update.latestVersion}$2`);
                
                // If no template variables, also replace in image field
                if (!update.hasVariables) {
                    const oldImagePattern = new RegExp(
                        `(image:\\s*[^:]+):${update.currentVersion.replace(/\./g, '\\.')}`,
                        'g'
                    );
                    content = content.replace(oldImagePattern, `$1:${update.latestVersion}`);
                }
                
                fs.writeFileSync(filePath, content);
                console.log(`  ✅ Updated ${update.file}`);
                successCount++;
            } catch (error) {
                console.error(`  ❌ Error updating ${update.file}:`, error.message);
            }
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
        specificApps: [],
        limit: null
    };
    
    const appIndex = args.indexOf('--apps');
    if (appIndex !== -1 && args[appIndex + 1]) {
        options.specificApps = args[appIndex + 1].split(',');
    }
    
    const limitIndex = args.indexOf('--limit');
    if (limitIndex !== -1 && args[limitIndex + 1]) {
        options.limit = parseInt(args[limitIndex + 1]);
    }
    
    if (args.includes('--help')) {
        console.log(`
Advanced Update Checker - Template Variable Support

Usage:
  node advanced_checker.js [options]

Options:
  --help               Show this help message
  --apply              Apply updates to YAML files
  --dry-run            Preview updates without applying
  --patch-only         Only apply patch updates
  --minor-and-patch    Apply minor and patch updates
  --apps <list>        Check specific apps (comma-separated)
  --limit <n>          Limit to first N apps (for testing)

Examples:
  # Check first 10 apps (quick test)
  node advanced_checker.js --limit 10

  # Check specific apps
  node advanced_checker.js --apps wordpress.yml,gitea.yml

  # Apply patch updates
  node advanced_checker.js --apply --patch-only

  # Dry run to see what would be updated
  node advanced_checker.js --dry-run --minor-and-patch
        `);
        return;
    }
    
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

if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = {
    checkAllApps,
    applyUpdates,
    extractAppConfig,
    parseDockerImage,
    compareVersions,
    getDockerHubLatestVersion,
    detectUpdate,
    determineUpdateType
};
