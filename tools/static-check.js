'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = readJson('app.json');
const errors = [];
const warnings = [];

function fail(message) { errors.push(message); }
function warn(message) { warnings.push(message); }
function readJson(relativePath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
  } catch (error) {
    throw new Error(`${relativePath}: ${error.message}`);
  }
}
function existsManifestPath(value) {
  const relative = String(value).replace(/^\//, '');
  return fs.existsSync(path.join(root, relative));
}
function assertTranslation(value, location) {
  if (!value || typeof value !== 'object' || typeof value.en !== 'string' || !value.en.trim()) {
    fail(`${location} must contain a non-empty English translation.`);
  }
  const supported = new Set(['en', 'nl', 'de', 'fr', 'it', 'sv', 'no', 'es', 'da', 'ru', 'pl', 'ko', 'ar', 'sk']);
  for (const locale of Object.keys(value || {})) {
    if (!supported.has(locale)) fail(`${location} uses unsupported Homey locale '${locale}'.`);
  }
}
function pngSize(filePath) {
  const b = fs.readFileSync(filePath);
  if (b.length < 24 || b.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

if (manifest.id !== 'com.tothk.xhouse') fail('Unexpected app id.');
if (manifest.sdk !== 3) fail('Homey SDK must be 3.');
if (manifest.runtime !== 'nodejs') fail('Runtime must be nodejs.');
if (!Array.isArray(manifest.platforms) || !manifest.platforms.includes('local')) fail('Local Homey platform is required.');
if (typeof manifest.category !== 'string') fail('App category must be a string.');
assertTranslation(manifest.name, 'app.name');
assertTranslation(manifest.description, 'app.description');

for (const [key, dimensions] of Object.entries({ small: [250, 175], large: [500, 350], xlarge: [1000, 700] })) {
  const image = manifest.images?.[key];
  if (!image || !existsManifestPath(image)) {
    fail(`Missing app ${key} image.`);
    continue;
  }
  const actual = pngSize(path.join(root, image.replace(/^\//, '')));
  if (!actual || actual.width !== dimensions[0] || actual.height !== dimensions[1]) {
    fail(`App ${key} image must be ${dimensions[0]}x${dimensions[1]}.`);
  }
}
if (!fs.existsSync(path.join(root, 'assets/icon.svg'))) fail('Missing app icon.svg.');

const customCapabilities = new Set(Object.keys(manifest.capabilities || {}));
const knownSystemCapabilities = new Set(['garagedoor_closed', 'windowcoverings_state']);
const driverIds = new Set();
for (const driver of manifest.drivers || []) {
  if (!driver.id || driverIds.has(driver.id)) fail(`Duplicate or missing driver id '${driver.id}'.`);
  driverIds.add(driver.id);
  assertTranslation(driver.name, `driver.${driver.id}.name`);
  const driverRoot = path.join(root, 'drivers', driver.id);
  for (const file of ['driver.js', 'device.js', 'assets/icon.svg']) {
    if (!fs.existsSync(path.join(driverRoot, file))) fail(`Driver ${driver.id} is missing ${file}.`);
  }
  for (const capability of driver.capabilities || []) {
    if (!customCapabilities.has(capability) && !knownSystemCapabilities.has(capability)) {
      fail(`Driver ${driver.id} references unknown capability '${capability}'.`);
    }
  }
  for (const [key, dimensions] of Object.entries({ small: [75, 75], large: [500, 500], xlarge: [1000, 1000] })) {
    const image = driver.images?.[key];
    if (!image || !existsManifestPath(image)) {
      fail(`Driver ${driver.id} is missing ${key} image.`);
      continue;
    }
    const actual = pngSize(path.join(root, image.replace(/^\//, '')));
    if (!actual || actual.width !== dimensions[0] || actual.height !== dimensions[1]) {
      fail(`Driver ${driver.id} ${key} image has invalid dimensions.`);
    }
  }
  for (const view of [...(driver.pair || []), ...(driver.repair || [])]) {
    if (view.template === 'login_credentials' && view.options?.logo) {
      const logo = path.join(driverRoot, 'pair', view.options.logo);
      if (!fs.existsSync(logo)) fail(`Driver ${driver.id} pairing logo is missing: ${view.options.logo}.`);
    }
  }
}

for (const [id, capability] of Object.entries(manifest.capabilities || {})) {
  assertTranslation(capability.title, `capability.${id}.title`);
  if (capability.type === 'enum') {
    if (!Array.isArray(capability.values) || capability.values.length === 0) fail(`Enum ${id} has no values.`);
    for (const value of capability.values || []) assertTranslation(value.title, `capability.${id}.${value.id}`);
  }
  if (capability.type === 'number' && capability.min >= capability.max) fail(`Number capability ${id} has an invalid range.`);
}

const allFlowIds = new Set();
for (const group of ['triggers', 'conditions', 'actions']) {
  for (const card of manifest.flow?.[group] || []) {
    if (!card.id || allFlowIds.has(card.id)) fail(`Duplicate or missing Flow card id '${card.id}'.`);
    allFlowIds.add(card.id);
    assertTranslation(card.title, `flow.${group}.${card.id}.title`);
  }
}

for (const required of ['README.md', 'README.txt', 'INSTALLATION_SK.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  if (!fs.existsSync(path.join(root, required))) fail(`Missing ${required}.`);
}
if (!fs.existsSync(path.join(root, 'locales/en.json'))) fail('Missing English locale file.');
for (const file of fs.readdirSync(path.join(root, 'locales'))) {
  if (!['en.json', 'nl.json', 'de.json', 'fr.json', 'it.json', 'sv.json', 'no.json', 'es.json', 'da.json', 'ru.json', 'pl.json', 'ko.json', 'ar.json', 'sk.json'].includes(file)) {
    fail(`Unsupported locale file: ${file}.`);
  }
}

const packageJson = readJson('package.json');
if (Object.keys(packageJson.dependencies || {}).length > 0) warn('Runtime dependencies are present; verify they are needed.');

for (const message of warnings) console.warn(`WARN: ${message}`);
if (errors.length) {
  for (const message of errors) console.error(`ERROR: ${message}`);
  process.exitCode = 1;
} else {
  console.log(`Static check passed: ${driverIds.size} drivers, ${customCapabilities.size} custom capabilities, ${allFlowIds.size} Flow cards.`);
}
