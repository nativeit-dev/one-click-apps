#!/usr/bin/env node

/**
 * GitHub Releases Version Checker
 * 
 * This module provides functionality to check for updates via GitHub releases.
 * Many Docker images are built from GitHub repositories and their versions
 * correspond to GitHub release tags.
 */

const https = require('https');
const fs = require('fs-extra');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '../.version-cache');
const GITHUB_DELAY = 1000; // 1 second between requests

// Ensure cache directory exists
fs.ensureDirSync(CACHE_DIR);

/**
 * Make GitHub API request
 */
function makeGitHubRequest(url, token = null) {
    return new Promise((resolve, reject) => {
        const headers = {
            'User-Agent': 'Caprover-Update-Checker/1.0',
            'Accept': 'application/vnd.github.v3+json'
        };

        // Use GitHub token if provided (increases rate limit from 60 to 5000 per hour)
        if (token) {
            headers['Authorization'] = `token ${token}`;
        } else if (process.env.GITHUB_TOKEN) {
            headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
        }

        https.get(url, { headers }, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`Failed to parse JSON: ${e.message}`));
                    }
                } else if (res.statusCode === 404) {
                    resolve(null);
                } else if (res.statusCode === 403) {
                    // Rate limit exceeded
                    const resetTime = res.headers['x-ratelimit-reset'];
                    reject(new Error(`GitHub API rate limit exceeded. Resets at ${new Date(resetTime * 1000)}`));
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
 * Map common Docker images to their GitHub repositories
 * This mapping helps identify the source repository for version checking
 */
const DOCKER_TO_GITHUB_MAP = {
    // Official projects with Docker images
    'gitea/gitea': 'go-gitea/gitea',
    'nextcloud': 'nextcloud/server',
    'ghost': 'TryGhost/Ghost',
    'grafana/grafana': 'grafana/grafana',
    'n8nio/n8n': 'n8n-io/n8n',
    'plausible/analytics': 'plausible/analytics',
    'photoprism/photoprism': 'photoprism/photoprism',
    'louislam/uptime-kuma': 'louislam/uptime-kuma',
    'vaultwarden/server': 'dani-garcia/vaultwarden',
    'jlesage/handbrake': 'jlesage/docker-handbrake',
    'linuxserver/plex': 'linuxserver/docker-plex',
    'calibre-web/calibre-web': 'janeczku/calibre-web',
    'directus/directus': 'directus/directus',
    'appwrite/appwrite': 'appwrite/appwrite',
    'supabase/postgres': 'supabase/postgres',
    'nocodb/nocodb': 'nocodb/nocodb',
    'standardnotes/web': 'standardnotes/app',
    'baserow/baserow': 'bram2w/baserow',
    'docusealco/docuseal': 'docusealco/docuseal',
    'getmeili/meilisearch': 'meilisearch/meilisearch',
    'typesense/typesense': 'typesense/typesense',
    'activepieces/activepieces': 'activepieces/activepieces',
    'budibase/budibase': 'Budibase/budibase',
    'owncloud/server': 'owncloud/core',
    'seafile/seafile-mc': 'haiwen/seafile',
    'joplin/server': 'laurent22/joplin',
    'vikunja/vikunja': 'go-vikunja/vikunja',
    'bookstackapp/bookstack': 'BookStackApp/BookStack',
    'wikijs/wiki': 'Requarks/wiki',
    'glpi/glpi': 'glpi-project/glpi',
    'matomo/matomo': 'matomo-org/matomo',
    'chatwoot/chatwoot': 'chatwoot/chatwoot',
    'discourse/discourse': 'discourse/discourse',
    'mattermost/mattermost-team-edition': 'mattermost/mattermost-server',
    'rocketchat/rocket.chat': 'RocketChat/Rocket.Chat',
    'ethibox/adminer': 'vrana/adminer',
    'jellyfin/jellyfin': 'jellyfin/jellyfin',
    'filebrowser/filebrowser': 'filebrowser/filebrowser',
    'netbox/netbox': 'netbox-community/netbox',
    'outline/outline': 'outline/outline',
    'hedgedoc/hedgedoc': 'hedgedoc/hedgedoc',
    'code-server/code-server': 'coder/code-server',
    'forgejo/forgejo': 'codeberg.org/forgejo/forgejo'
};

/**
 * Get GitHub repository from Docker image name
 */
function getGitHubRepo(dockerImage) {
    // Remove version tag
    const imageName = dockerImage.split(':')[0];
    
    // Check direct mapping
    if (DOCKER_TO_GITHUB_MAP[imageName]) {
        return DOCKER_TO_GITHUB_MAP[imageName];
    }
    
    // Try to infer from image name
    const parts = imageName.split('/');
    
    // For namespace/repo format, try as-is
    if (parts.length === 2) {
        return imageName;
    }
    
    return null;
}

/**
 * Get latest release from GitHub repository
 */
async function getGitHubLatestRelease(owner, repo) {
    try {
        const cacheKey = `github_${owner}_${repo}`;
        const cacheFile = path.join(CACHE_DIR, `${cacheKey}.json`);
        
        // Check cache (valid for 1 hour)
        if (fs.existsSync(cacheFile)) {
            const stats = fs.statSync(cacheFile);
            const age = Date.now() - stats.mtimeMs;
            if (age < 3600000) { // 1 hour
                return fs.readJsonSync(cacheFile);
            }
        }

        // Fetch from GitHub API
        const url = `https://api.github.com/repos/${owner}/${repo}/releases`;
        
        await sleep(GITHUB_DELAY);
        const releases = await makeGitHubRequest(url);
        
        if (!releases || releases.length === 0) {
            return null;
        }

        // Filter out pre-releases and drafts
        const stableReleases = releases.filter(r => !r.prerelease && !r.draft);
        
        if (stableReleases.length === 0) {
            return null;
        }

        // Get latest stable release
        const latest = stableReleases[0];
        
        // Clean up version tag (remove 'v' prefix if present)
        const version = latest.tag_name.replace(/^v/, '');
        
        const result = {
            version,
            tagName: latest.tag_name,
            name: latest.name,
            publishedAt: latest.published_at,
            htmlUrl: latest.html_url,
            allVersions: stableReleases.slice(0, 10).map(r => ({
                version: r.tag_name.replace(/^v/, ''),
                tagName: r.tag_name,
                publishedAt: r.published_at
            })),
            lastChecked: new Date().toISOString()
        };

        // Cache the result
        fs.writeJsonSync(cacheFile, result);
        
        return result;
    } catch (error) {
        console.error(`Error fetching GitHub releases for ${owner}/${repo}:`, error.message);
        return null;
    }
}

/**
 * Get GitHub release information for a Docker image
 */
async function getGitHubVersionForImage(dockerImage) {
    const repoPath = getGitHubRepo(dockerImage);
    
    if (!repoPath) {
        return null;
    }
    
    const [owner, repo] = repoPath.split('/');
    
    if (!owner || !repo) {
        return null;
    }
    
    return await getGitHubLatestRelease(owner, repo);
}

/**
 * Compare current version with GitHub release
 */
function compareWithGitHub(currentVersion, githubInfo) {
    if (!githubInfo || !githubInfo.version) {
        return null;
    }
    
    const latestVersion = githubInfo.version;
    
    // Use the same comparison logic as Docker Hub checker
    try {
        const comparison = compareVersions(latestVersion, currentVersion);
        if (comparison > 0) {
            return {
                hasUpdate: true,
                currentVersion,
                latestVersion,
                source: 'github',
                releaseUrl: githubInfo.htmlUrl,
                publishedAt: githubInfo.publishedAt
            };
        }
    } catch (error) {
        return null;
    }
    
    return {
        hasUpdate: false,
        currentVersion,
        latestVersion,
        source: 'github'
    };
}

/**
 * Simple version comparison (same as in check_updates.js)
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
 * Check GitHub rate limit status
 */
async function checkRateLimit() {
    try {
        const url = 'https://api.github.com/rate_limit';
        const data = await makeGitHubRequest(url);
        
        if (data && data.rate) {
            return {
                limit: data.rate.limit,
                remaining: data.rate.remaining,
                reset: new Date(data.rate.reset * 1000),
                authenticated: data.rate.limit > 60
            };
        }
        
        return null;
    } catch (error) {
        console.error('Error checking GitHub rate limit:', error.message);
        return null;
    }
}

/**
 * Test function to verify GitHub API connectivity
 */
async function testGitHubAccess() {
    console.log('🔍 Testing GitHub API access...\n');
    
    const rateLimit = await checkRateLimit();
    
    if (rateLimit) {
        console.log('✅ GitHub API is accessible');
        console.log(`   Authenticated: ${rateLimit.authenticated ? 'Yes' : 'No (using IP-based limit)'}`);
        console.log(`   Rate limit: ${rateLimit.remaining}/${rateLimit.limit} remaining`);
        console.log(`   Resets at: ${rateLimit.reset}`);
        
        if (!rateLimit.authenticated) {
            console.log('\n💡 Tip: Set GITHUB_TOKEN environment variable to increase rate limit to 5000/hour');
        }
    } else {
        console.log('❌ Could not access GitHub API');
    }
    
    // Test a sample repository
    console.log('\n🧪 Testing sample repository (gitea/gitea)...\n');
    const giteaInfo = await getGitHubLatestRelease('go-gitea', 'gitea');
    
    if (giteaInfo) {
        console.log('✅ Successfully fetched release info:');
        console.log(`   Latest version: ${giteaInfo.version}`);
        console.log(`   Tag name: ${giteaInfo.tagName}`);
        console.log(`   Published: ${giteaInfo.publishedAt}`);
        console.log(`   URL: ${giteaInfo.htmlUrl}`);
    } else {
        console.log('❌ Could not fetch release info');
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--test')) {
        await testGitHubAccess();
        return;
    }
    
    if (args.includes('--help')) {
        console.log(`
GitHub Releases Version Checker

Usage:
  node github_checker.js --test              Test GitHub API access
  node github_checker.js --image <image>     Check version for specific image
  node github_checker.js --repo <owner/repo> Check latest release for repo

Environment Variables:
  GITHUB_TOKEN    GitHub personal access token (optional, increases rate limit)

Examples:
  node github_checker.js --test
  node github_checker.js --image gitea/gitea:1.21.1
  node github_checker.js --repo go-gitea/gitea
        `);
        return;
    }
    
    const imageIndex = args.indexOf('--image');
    if (imageIndex !== -1 && args[imageIndex + 1]) {
        const image = args[imageIndex + 1];
        console.log(`🔍 Checking GitHub releases for: ${image}\n`);
        
        const info = await getGitHubVersionForImage(image);
        
        if (info) {
            console.log('✅ Found GitHub release info:');
            console.log(`   Latest version: ${info.version}`);
            console.log(`   Published: ${info.publishedAt}`);
            console.log(`   URL: ${info.htmlUrl}`);
            
            const currentVersion = image.split(':')[1];
            if (currentVersion) {
                const comparison = compareWithGitHub(currentVersion, info);
                if (comparison && comparison.hasUpdate) {
                    console.log(`\n🆕 Update available: ${currentVersion} → ${info.version}`);
                } else {
                    console.log(`\n✓ Current version ${currentVersion} is up to date`);
                }
            }
        } else {
            console.log('❌ Could not find GitHub release info');
            console.log('   This image may not have a mapped GitHub repository');
        }
        return;
    }
    
    const repoIndex = args.indexOf('--repo');
    if (repoIndex !== -1 && args[repoIndex + 1]) {
        const repo = args[repoIndex + 1];
        const [owner, repoName] = repo.split('/');
        
        console.log(`🔍 Checking GitHub releases for: ${owner}/${repoName}\n`);
        
        const info = await getGitHubLatestRelease(owner, repoName);
        
        if (info) {
            console.log('✅ Latest release:');
            console.log(`   Version: ${info.version}`);
            console.log(`   Tag: ${info.tagName}`);
            console.log(`   Name: ${info.name}`);
            console.log(`   Published: ${info.publishedAt}`);
            console.log(`   URL: ${info.htmlUrl}`);
            console.log(`\n📋 Recent versions:`);
            info.allVersions.forEach((v, i) => {
                console.log(`   ${i + 1}. ${v.version} (${v.publishedAt})`);
            });
        } else {
            console.log('❌ Could not find release info');
        }
        return;
    }
    
    // Default: run test
    await testGitHubAccess();
}

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = {
    getGitHubRepo,
    getGitHubLatestRelease,
    getGitHubVersionForImage,
    compareWithGitHub,
    checkRateLimit,
    DOCKER_TO_GITHUB_MAP
};
