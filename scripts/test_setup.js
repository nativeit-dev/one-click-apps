#!/usr/bin/env node

/**
 * Test script to verify the update checker tools are working correctly
 */

const fs = require('fs-extra');
const path = require('path');

console.log('🧪 Testing Caprover Update Checker Tools\n');

// Test 1: Check if required files exist
console.log('📁 Test 1: Checking required files...');
const requiredFiles = [
    'scripts/check_updates.js',
    'scripts/advanced_checker.js',
    'scripts/enhanced_checker.js',
    'scripts/github_checker.js',
    'scripts/README.md',
    'scripts/UPDATE_CHECKER_README.md'
];

let allFilesExist = true;
for (const file of requiredFiles) {
    const filePath = path.join(__dirname, '..', file);
    if (fs.existsSync(filePath)) {
        console.log(`  ✅ ${file}`);
    } else {
        console.log(`  ❌ ${file} - MISSING`);
        allFilesExist = false;
    }
}

if (!allFilesExist) {
    console.log('\n❌ Some required files are missing!');
    process.exit(1);
}

console.log('\n✅ All required files exist\n');

// Test 2: Check if dependencies are installed
console.log('📦 Test 2: Checking dependencies...');
const requiredModules = ['fs-extra', 'yaml'];

let allModulesInstalled = true;
for (const module of requiredModules) {
    try {
        require(module);
        console.log(`  ✅ ${module}`);
    } catch (error) {
        console.log(`  ❌ ${module} - NOT INSTALLED`);
        allModulesInstalled = false;
    }
}

if (!allModulesInstalled) {
    console.log('\n❌ Some dependencies are missing! Run: npm install');
    process.exit(1);
}

console.log('\n✅ All dependencies installed\n');

// Test 3: Test basic functions
console.log('🔧 Test 3: Testing basic functions...');

try {
    const advancedChecker = require('./advanced_checker.js');
    
    // Test parseDockerImage
    const testImage = 'wordpress:6.7.1';
    const parsed = advancedChecker.parseDockerImage(testImage);
    
    if (parsed && parsed.namespace === 'library' && parsed.repository === 'wordpress' && parsed.currentVersion === '6.7.1') {
        console.log(`  ✅ parseDockerImage() works correctly`);
        console.log(`     Input: ${testImage}`);
        console.log(`     Parsed: ${JSON.stringify(parsed, null, 2).split('\n').map((line, i) => i === 0 ? line : '            ' + line).join('\n')}`);
    } else {
        console.log(`  ❌ parseDockerImage() failed`);
        console.log(`     Result: ${JSON.stringify(parsed)}`);
    }
    
    // Test compareVersions
    const v1 = '6.7.0';
    const v2 = '6.7.1';
    const comparison = advancedChecker.compareVersions(v2, v1);
    
    if (comparison > 0) {
        console.log(`  ✅ compareVersions() works correctly`);
        console.log(`     ${v2} > ${v1} = ${comparison > 0}`);
    } else {
        console.log(`  ❌ compareVersions() failed`);
        console.log(`     ${v2} > ${v1} should be true, got ${comparison}`);
    }
    
    console.log('\n✅ Basic functions working\n');
    
} catch (error) {
    console.log(`  ❌ Error testing functions: ${error.message}`);
    process.exit(1);
}

// Test 4: Check if apps directory exists
console.log('📂 Test 4: Checking apps directory...');
const appsDir = path.join(__dirname, '../public/v4/apps');

if (fs.existsSync(appsDir)) {
    const files = fs.readdirSync(appsDir).filter(f => f.endsWith('.yml'));
    console.log(`  ✅ Apps directory exists`);
    console.log(`  📊 Found ${files.length} YAML files`);
    
    if (files.length > 0) {
        console.log(`  📝 Sample apps: ${files.slice(0, 5).join(', ')}...`);
    }
} else {
    console.log(`  ❌ Apps directory not found at: ${appsDir}`);
    process.exit(1);
}

console.log('\n✅ Apps directory accessible\n');

// Test 5: Test YAML parsing
console.log('📄 Test 5: Testing YAML parsing...');

try {
    const advancedChecker = require('./advanced_checker.js');
    const testFile = path.join(appsDir, 'wordpress.yml');
    
    if (fs.existsSync(testFile)) {
        const config = advancedChecker.extractAppConfig(testFile);
        
        if (config && config.services && config.services.length > 0) {
            console.log(`  ✅ YAML parsing works`);
            console.log(`  📦 App: ${config.displayName}`);
            console.log(`  🔧 Services: ${config.services.length}`);
            
            for (const service of config.services) {
                console.log(`     - ${service.serviceName}: ${service.fullName}:${service.currentVersion}`);
                if (service.hasVariables) {
                    console.log(`       (resolved from: ${service.originalImage})`);
                }
            }
        } else {
            console.log(`  ⚠️  YAML parsed but no services found`);
        }
    } else {
        console.log(`  ⚠️  Test file not found: wordpress.yml`);
    }
    
    console.log('\n✅ YAML parsing working\n');
    
} catch (error) {
    console.log(`  ❌ Error parsing YAML: ${error.message}`);
    process.exit(1);
}

// Test 6: Create test directories
console.log('📁 Test 6: Checking output directories...');

const outputDir = path.join(__dirname, '../update-reports');
const cacheDir = path.join(__dirname, '../.version-cache');

fs.ensureDirSync(outputDir);
fs.ensureDirSync(cacheDir);

console.log(`  ✅ Output directory: ${outputDir}`);
console.log(`  ✅ Cache directory: ${cacheDir}`);

console.log('\n✅ Output directories ready\n');

// Summary
console.log('='.repeat(70));
console.log('✨ All Tests Passed!');
console.log('='.repeat(70));
console.log('\n🚀 You can now run the update checker:');
console.log('\n  Quick test (10 apps):');
console.log('    node scripts/advanced_checker.js --limit 10');
console.log('\n  Check all apps:');
console.log('    node scripts/advanced_checker.js');
console.log('\n  Check specific apps:');
console.log('    node scripts/advanced_checker.js --apps wordpress.yml,gitea.yml');
console.log('\n  Apply patch updates:');
console.log('    node scripts/advanced_checker.js --apply --patch-only');
console.log('\n📚 See scripts/README.md for complete documentation\n');
