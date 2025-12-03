#!/usr/bin/env node

/**
 * Enhanced Update Checker - Combines Docker Hub and GitHub
 * 
 * This script integrates both Docker Hub API and GitHub Releases API
 * to provide comprehensive version checking across all sources.
 */

const dockerChecker = require('./check_updates');
const githubChecker = require('./github_checker');
const advancedChecker = require('./advanced_checker');
const fs = require('fs-extra');
const path = require('path');
const yaml = require('yaml');

const APPS_DIR = path.join(__dirname, '../public/v4/apps');
const OUTPUT_DIR = path.join(__dirname, '../update-reports');

fs.ensureDirSync(OUTPUT_DIR);

/**
 * Check both Docker Hub and GitHub for updates
 */
async function checkBothSources(image) {
    const results = {
        image: image.full,
        currentVersion: image.currentVersion,
        dockerHub: null,
        github: null,
        recommendation: null
    };

    // Check Docker Hub
    try {
        const dockerHubInfo = await advancedChecker.getDockerHubLatestVersion(
            image.namespace,
            image.repository
        );
        
        if (dockerHubInfo && dockerHubInfo.latestStable) {
            results.dockerHub = {
                latestVersion: dockerHubInfo.latestStable,
                versions: dockerHubInfo.versions.slice(0, 5).map(v => v.name)
            };
        }
    } catch (error) {
        console.error(`  ⚠️  Docker Hub check failed: ${error.message}`);
    }

    // Check GitHub
    try {
        const githubInfo = await githubChecker.getGitHubVersionForImage(image.full);
        
        if (githubInfo) {
            results.github = {
                latestVersion: githubInfo.version,
                releaseUrl: githubInfo.htmlUrl,
                publishedAt: githubInfo.publishedAt,
                versions: githubInfo.allVersions.slice(0, 5).map(v => v.version)
            };
        }
    } catch (error) {
        console.error(`  ⚠️  GitHub check failed: ${error.message}`);
    }

    // Determine recommendation
    if (results.dockerHub && results.github) {
        // Both sources available - compare
        const dockerVersion = results.dockerHub.latestVersion;
        const githubVersion = results.github.latestVersion;
        
        const comparison = advancedChecker.compareVersions(dockerVersion, githubVersion);
        
        if (comparison === 0) {
            // Same version - both are in sync
            results.recommendation = {
                source: 'both',
                version: dockerVersion,
                note: 'Docker Hub and GitHub are in sync'
            };
        } else if (comparison > 0) {
            // Docker Hub has newer version
            results.recommendation = {
                source: 'dockerhub',
                version: dockerVersion,
                note: 'Docker Hub has a newer version than GitHub releases'
            };
        } else {
            // GitHub has newer version
            results.recommendation = {
                source: 'github',
                version: githubVersion,
                note: 'GitHub has a newer release, Docker image may not be built yet',
                warning: true
            };
        }
    } else if (results.dockerHub) {
        results.recommendation = {
            source: 'dockerhub',
            version: results.dockerHub.latestVersion,
            note: 'Using Docker Hub (GitHub releases not available)'
        };
    } else if (results.github) {
        results.recommendation = {
            source: 'github',
            version: results.github.latestVersion,
            note: 'Using GitHub releases (Docker Hub not available)',
            warning: true
        };
    }

    // Check if update is available
    if (results.recommendation) {
        const updateInfo = advancedChecker.detectUpdate(
            results.currentVersion,
            results.recommendation.version
        );
        
        if (updateInfo) {
            results.updateAvailable = updateInfo.hasUpdate;
            results.updateType = updateInfo.updateType;
        }
    }

    return results;
}

/**
 * Enhanced check for all apps
 */
async function checkAllAppsEnhanced(options = {}) {
    const { specificApps = [], useGitHub = true } = options;
    
    console.log('🚀 Enhanced Update Checker (Docker Hub + GitHub)\n');
    
    // Check GitHub rate limit if using GitHub
    if (useGitHub) {
        const rateLimit = await githubChecker.checkRateLimit();
        if (rateLimit) {
            console.log(`📊 GitHub API: ${rateLimit.remaining}/${rateLimit.limit} requests remaining`);
            if (!rateLimit.authenticated && rateLimit.remaining < 20) {
                console.log('⚠️  Warning: Low GitHub API rate limit. Consider setting GITHUB_TOKEN');
            }
            console.log('');
        }
    }
    
    console.log('🔍 Scanning for one-click apps...\n');
    
    const files = fs.readdirSync(APPS_DIR)
        .filter(f => f.endsWith('.yml'))
        .filter(f => specificApps.length === 0 || specificApps.includes(f));
    
    console.log(`Found ${files.length} app definition(s)\n`);
    
    const results = [];
    let processedCount = 0;
    
    for (const file of files) {
        const filePath = path.join(APPS_DIR, file);
        
        try {
            // Use advanced extraction to handle template variables
            const appConfig = advancedChecker.extractAppConfig(filePath);
            
            if (!appConfig || appConfig.services.length === 0) {
                continue;
            }
            
            console.log(`📦 Processing: ${file}`);
            
            for (const service of appConfig.services) {
                console.log(`  🔎 ${service.fullName}:${service.currentVersion}`);
                
                if (service.hasVariables) {
                    console.log(`    📝 Resolved from template: ${service.originalImage}`);
                }
                
                // Create parsed object in expected format
                const parsed = {
                    full: service.resolvedImage,
                    registry: service.registry,
                    namespace: service.namespace,
                    repository: service.repository,
                    fullName: service.fullName,
                    currentVersion: service.currentVersion,
                    isOfficial: service.isOfficial
                };
                
                let checkResult;
                
                if (useGitHub) {
                    // Use enhanced checking with both sources
                    checkResult = await checkBothSources(parsed);
                    
                    if (checkResult.dockerHub) {
                        console.log(`    🐳 Docker Hub: ${checkResult.dockerHub.latestVersion}`);
                    }
                    if (checkResult.github) {
                        console.log(`    🐙 GitHub: ${checkResult.github.latestVersion}`);
                    }
                    
                    if (checkResult.recommendation) {
                        const rec = checkResult.recommendation;
                        const emoji = rec.warning ? '⚠️' : '✅';
                        console.log(`    ${emoji} Recommended: ${rec.version} (${rec.source})`);
                        
                        if (checkResult.updateAvailable) {
                            console.log(`    🆕 Update available: ${parsed.currentVersion} → ${rec.version} (${checkResult.updateType})`);
                            
                            results.push({
                                file,
                                serviceName: service.serviceName,
                                image: parsed.fullName,
                                imageReference: service.originalImage,
                                hasVariables: service.hasVariables,
                                currentVersion: parsed.currentVersion,
                                recommendedVersion: rec.version,
                                updateType: checkResult.updateType,
                                source: rec.source,
                                dockerHub: checkResult.dockerHub,
                                github: checkResult.github,
                                note: rec.note
                            });
                        } else {
                            console.log(`    ✓ Up to date`);
                        }
                    } else {
                        console.log(`    ⚠️  Could not determine version`);
                    }
                } else {
                    // Docker Hub only (original behavior)
                    const dockerHubInfo = await advancedChecker.getDockerHubLatestVersion(
                        parsed.namespace,
                        parsed.repository
                    );
                    
                    if (dockerHubInfo && dockerHubInfo.latestStable) {
                        const updateInfo = advancedChecker.detectUpdate(
                            parsed.currentVersion,
                            dockerHubInfo.latestStable
                        );
                        
                        if (updateInfo && updateInfo.hasUpdate) {
                            console.log(`    ✅ Update available: ${parsed.currentVersion} → ${dockerHubInfo.latestStable} (${updateInfo.updateType})`);
                            
                            results.push({
                                file,
                                serviceName: service.serviceName,
                                image: parsed.fullName,
                                imageReference: service.originalImage,
                                hasVariables: service.hasVariables,
                                currentVersion: parsed.currentVersion,
                                recommendedVersion: dockerHubInfo.latestStable,
                                updateType: updateInfo.updateType,
                                source: 'dockerhub',
                                dockerHub: {
                                    latestVersion: dockerHubInfo.latestStable,
                                    versions: dockerHubInfo.versions.slice(0, 5).map(v => v.name)
                                }
                            });
                        } else {
                            console.log(`    ✓ Up to date`);
                        }
                    } else {
                        console.log(`    ⚠️  Could not fetch version info`);
                    }
                }
            }
            
            processedCount++;
            console.log('');
            
        } catch (error) {
            console.error(`  ❌ Error processing ${file}: ${error.message}`);
            console.log('');
        }
    }
    
    // Generate comprehensive report
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(OUTPUT_DIR, `enhanced-report-${timestamp}.json`);
    
    const report = {
        timestamp: new Date().toISOString(),
        mode: useGitHub ? 'enhanced' : 'dockerhub-only',
        totalAppsChecked: processedCount,
        totalUpdatesAvailable: results.length,
        updates: results,
        summary: {
            major: results.filter(r => r.updateType === 'major').length,
            minor: results.filter(r => r.updateType === 'minor').length,
            patch: results.filter(r => r.updateType === 'patch').length,
            other: results.filter(r => r.updateType === 'other').length
        },
        sources: {
            dockerhub: results.filter(r => r.source === 'dockerhub' || r.source === 'both').length,
            github: results.filter(r => r.source === 'github').length,
            both: results.filter(r => r.source === 'both').length
        }
    };
    
    fs.writeJsonSync(reportPath, report, { spaces: 2 });
    
    // Generate markdown report
    const mdReportPath = path.join(OUTPUT_DIR, `enhanced-report-${timestamp}.md`);
    const mdReport = generateEnhancedMarkdownReport(report);
    fs.writeFileSync(mdReportPath, mdReport);
    
    // Print summary
    console.log('='.repeat(80));
    console.log('📊 SUMMARY');
    console.log('='.repeat(80));
    console.log(`Apps checked: ${processedCount}`);
    console.log(`Updates available: ${results.length}`);
    console.log(`  - Major updates: ${report.summary.major}`);
    console.log(`  - Minor updates: ${report.summary.minor}`);
    console.log(`  - Patch updates: ${report.summary.patch}`);
    
    if (useGitHub) {
        console.log(`\nSources:`);
        console.log(`  - Docker Hub: ${report.sources.dockerhub}`);
        console.log(`  - GitHub: ${report.sources.github}`);
        console.log(`  - Both in sync: ${report.sources.both}`);
    }
    
    console.log(`\nReports saved to:`);
    console.log(`  - JSON: ${reportPath}`);
    console.log(`  - Markdown: ${mdReportPath}`);
    
    return report;
}

/**
 * Generate enhanced markdown report
 */
function generateEnhancedMarkdownReport(report) {
    let md = `# Caprover Apps - Enhanced Update Report\n\n`;
    md += `**Generated:** ${report.timestamp}\n`;
    md += `**Mode:** ${report.mode}\n\n`;
    
    md += `## Summary\n\n`;
    md += `- **Apps Checked:** ${report.totalAppsChecked}\n`;
    md += `- **Updates Available:** ${report.totalUpdatesAvailable}\n`;
    md += `  - Major updates: ${report.summary.major}\n`;
    md += `  - Minor updates: ${report.summary.minor}\n`;
    md += `  - Patch updates: ${report.summary.patch}\n\n`;
    
    if (report.mode === 'enhanced') {
        md += `### Version Sources\n\n`;
        md += `- **Docker Hub:** ${report.sources.dockerhub} updates\n`;
        md += `- **GitHub Releases:** ${report.sources.github} updates\n`;
        md += `- **Both in sync:** ${report.sources.both} updates\n\n`;
    }
    
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
        md += `| App | Image | Current | Recommended | Source | Notes |\n`;
        md += `|-----|-------|---------|-------------|--------|-------|\n`;
        
        for (const update of updates) {
            const sourceEmoji = update.source === 'dockerhub' ? '🐳' : 
                               update.source === 'github' ? '🐙' : '🔄';
            const note = update.note || '';
            
            // Create anchor link for app name to details section
            const anchorId = `${update.image.replace(/\//g, '')}-${update.file.replace('.yml', '')}`;
            const appLink = `[${update.file}](#${anchorId})`;
            
            // Create links for versions
            const [namespace, repo] = update.image.split('/');
            const isOfficial = namespace === 'library';
            const dockerHubBase = isOfficial 
                ? `https://hub.docker.com/_/${repo}`
                : `https://hub.docker.com/r/${update.image}`;
            
            // Link current version to Docker Hub tags page
            const currentLink = `[${update.currentVersion}](${dockerHubBase}/tags)`;
            
            // Link recommended version based on source
            let recommendedLink;
            if (update.source === 'github' && update.github && update.github.releaseUrl) {
                recommendedLink = `[${update.recommendedVersion}](${update.github.releaseUrl})`;
            } else {
                recommendedLink = `[${update.recommendedVersion}](${dockerHubBase}/tags)`;
            }
            
            md += `| ${appLink} | ${update.image} | ${currentLink} | ${recommendedLink} | ${sourceEmoji} | ${note} |\n`;
        }
        md += `\n`;
        md += `**Source Legend:** 🐳 Docker Hub | 🐙 GitHub | 🔄 Both\n\n`;
    }
    
    // Add detailed version information
    md += `## Detailed Version Information\n\n`;
    
    for (const update of report.updates) {
        const [namespace, repo] = update.image.split('/');
        const isOfficial = namespace === 'library';
        const dockerHubBase = isOfficial 
            ? `https://hub.docker.com/_/${repo}`
            : `https://hub.docker.com/r/${update.image}`;
        const dockerHubTagsUrl = `${dockerHubBase}/tags`;
        
        // Create matching anchor ID for linking from table
        const anchorId = `${update.image.replace(/\//g, '')}-${update.file.replace('.yml', '')}`;
        
        md += `### <a id="${anchorId}"></a>${update.image} (${update.file})\n\n`;
        md += `- **Current:** [${update.currentVersion}](${dockerHubTagsUrl})\n`;
        
        // Link recommended based on source
        if (update.github && update.github.releaseUrl) {
            md += `- **Recommended:** [${update.recommendedVersion}](${update.github.releaseUrl})\n`;
        } else {
            md += `- **Recommended:** [${update.recommendedVersion}](${dockerHubTagsUrl})\n`;
        }
        md += `- **Update Type:** ${update.updateType}\n\n`;
        
        if (update.dockerHub) {
            md += `**Docker Hub versions:** ([view all tags](${dockerHubTagsUrl}))\n`;
            update.dockerHub.versions.forEach((v, i) => {
                md += `${i + 1}. ${v}\n`;
            });
            md += `\n`;
        }
        
        if (update.github) {
            const [owner, repoName] = update.image.includes('/') ? update.image.split('/') : ['', update.image];
            const githubReleasesUrl = update.github.releaseUrl ? 
                update.github.releaseUrl.substring(0, update.github.releaseUrl.lastIndexOf('/')) : '';
            
            md += `**GitHub releases:** ([view all releases](${githubReleasesUrl}))\n`;
            update.github.versions.forEach((v, i) => {
                md += `${i + 1}. ${v}\n`;
            });
            md += `\n`;
        }
        
        // Determine which table section to link back to
        const updateTypeEmoji = update.updateType === 'major' ? '🔴' : 
                               update.updateType === 'minor' ? '🟡' : 
                               update.updateType === 'patch' ? '🟢' : '🔵';
        const updateTypeLabel = update.updateType.charAt(0).toUpperCase() + update.updateType.slice(1);
        const tableAnchor = `${updateTypeEmoji}-${update.updateType}-updates-${report.summary[update.updateType]}`;
        
        md += `[↑ Back to ${updateTypeLabel} Updates table](#available-updates)\n\n`;
        md += `---\n\n`;
    }
    
    return md;
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);

    const options = {
        //applyUpdates: args.includes('--apply'),
        dryRun: args.includes('--dry-run'),
        patchOnly: args.includes('--patch-only'),
        minorAndPatch: args.includes('--minor-and-patch'),
        useGitHub: !args.includes('--no-github'),
        specificApps: []
    };

    // Extract specific apps
    const appIndex = args.indexOf('--apps');
    if (appIndex !== -1 && args[appIndex + 1]) {
        options.specificApps = args[appIndex + 1].split(',');
    }

    if (args.includes('--help')) {
        console.log(`
Enhanced Update Checker - Docker Hub + GitHub

Usage:
  node enhanced_checker.js [options]

Options:
  --help               Show this help message
  --apply              DISABLED: Apply updates to YAML files
  --dry-run            Preview updates without applying
  --patch-only         Only apply patch updates
  --minor-and-patch    Apply minor and patch updates
  --no-github          Disable GitHub checking (Docker Hub only)
  --apps <list>        Check specific apps (comma-separated)

Environment Variables:
  GITHUB_TOKEN         GitHub personal access token (increases rate limit)

Examples:
  # Check all apps (enhanced mode)
  node enhanced_checker.js

  # Check without GitHub (Docker Hub only)
  node enhanced_checker.js --no-github

  # Apply patch updates only
  node enhanced_checker.js --apply --patch-only

  # Dry run with specific apps
  node enhanced_checker.js --dry-run --apps wordpress.yml,gitea.yml

  # Full update with GitHub integration
  GITHUB_TOKEN=ghp_xxx node enhanced_checker.js --apply
        `);
        return;
    }
    
    console.log('🚀 Caprover One-Click Apps - Enhanced Update Checker\n');
    
    if (!options.useGitHub) {
        console.log('ℹ️  GitHub checking disabled (--no-github)\n');
    }
    
    // Check for updates
    const report = await checkAllAppsEnhanced(options);
    
    // Apply updates if requested <<-- this has been disabled for now, as there is no practical method for including dependencies
    // if (options.applyUpdates || options.dryRun) {
    //     let updateTypes = ['major', 'minor', 'patch', 'other'];
        
    //     if (options.patchOnly) {
    //         updateTypes = ['patch'];
    //     } else if (options.minorAndPatch) {
    //         updateTypes = ['minor', 'patch'];
    //     }
        
    //     await dockerChecker.applyUpdates(report, {
    //         updateTypes,
    //         dryRun: options.dryRun
    //     });
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
    checkAllAppsEnhanced,
    checkBothSources
};
