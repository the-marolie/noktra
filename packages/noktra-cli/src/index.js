#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { group, text, password, log, isCancel, tasks, confirm, outro, spinner } from '@clack/prompts';
import { crawlSite, discoverSitemapRoutes, saveLoginState, withProtocol, writeJsonFile } from 'noktra-crawler';
import {
    captureUrls,
    installChromium,
    isChromiumInstalled,
    loginAndKeepBrowser,
    readJsonFile,
    urlsFromRouteManifest,
} from 'noktra-snapshot';
import { compareManifests } from 'noktra-diff';
import { writeHtmlReport } from 'noktra-diff/report';

// The protocol is optional: "example.com" is accepted and becomes "https://example.com".
const validateUrl = (value) => {
    if (!value) return 'Please enter a valid URL';
    try {
        const url = new URL(withProtocol(value));
        const looksLikeHost = url.hostname.includes('.') || url.hostname === 'localhost';
        if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !looksLikeHost) return 'Please enter a valid URL';
    } catch {
        return 'Please enter a valid URL';
    }
    return undefined;
};

// Every project's answers are saved here, inside the project folder, so the wizard can be rerun without retyping them.
const CONFIG_FILE = 'noktra.config.json';
const CONFIG_VERSION = 1;
// The HTTP auth password is never written to the config file; it is asked for, or read from this variable.
const PASSWORD_ENV_VAR = 'NOKTRA_HTTP_PASSWORD';

const validateProjectName = (value) => {
    if (!value || value.length < 2) return 'Name must be at least 2 characters';
    return undefined;
};

const validateMaxRoutes = (value) => {
    // clack validates before applying defaultValue, so an empty answer must pass here
    if (!value) return undefined;
    const number = parseInt(value, 10);
    if (isNaN(number) || number <= 0) return 'Please enter a valid number greater than 0';
    return undefined;
};

const validateBoolean = (value) => (typeof value === 'boolean' ? undefined : 'must be true or false');

// Use the config file's value for `key` when it is present and valid; otherwise ask with `prompt`.
// Async because clack's group() expects every step to return a promise.
const fromConfig = (config, key, validate, prompt) => async (context) => {
    const value = config[key];
    if (value !== undefined) {
        const error = validate(typeof value === 'boolean' ? value : String(value));
        if (!error) return value;
        log.warn(`Config value "${key}" is invalid (${error}); please enter it.`);
    }
    return prompt(context);
};

const getInputs = (config = {}) =>
    group(
        {
            projectName: fromConfig(config, 'projectName', validateProjectName, () =>
                text({
                    message: 'Enter your project name:',
                    hint: 'A folder will be created in the projects directory with this name.',
                    validate: validateProjectName,
                })
            ),
            siteAUrl: fromConfig(config, 'siteAUrl', validateUrl, () =>
                text({
                    message: 'Enter the URL for Site A:',
                    hint: 'This will be used for configuring the project.',
                    validate: validateUrl,
                })
            ),
            siteBUrl: fromConfig(config, 'siteBUrl', validateUrl, () =>
                text({
                    message: 'Enter the URL for Site B:',
                    hint: 'This will be used for configuring the project.',
                    validate: validateUrl,
                })
            ),
            requireAuth: fromConfig(config, 'requireAuth', validateBoolean, () =>
                confirm({
                    message: 'Does this project require HTTP authentication?',
                })
            ),
            httpUsername: async ({ results }) =>
                results.requireAuth
                    ? fromConfig(config, 'httpUsername', (value) => (!value ? 'Username is required' : undefined), () =>
                          text({
                              message: 'HTTP authentication username:',
                              validate: (value) => (!value ? 'Username is required' : undefined),
                          })
                      )()
                    : undefined,
            httpPassword: async ({ results }) => {
                if (!results.requireAuth) return undefined;
                if (process.env[PASSWORD_ENV_VAR]) return process.env[PASSWORD_ENV_VAR];
                return password({
                    message: 'HTTP authentication password:',
                    validate: (value) => (!value ? 'Password is required' : undefined),
                });
            },
            requireLogin: fromConfig(config, 'requireLogin', validateBoolean, () =>
                confirm({
                    message: 'Does this project require login?',
                })
            ),
            isAnSPA: fromConfig(config, 'isAnSPA', validateBoolean, () =>
                confirm({
                    message: 'Is this project a Single Page Application (SPA)?',
                })
            ),
            maxRoutes: fromConfig(config, 'maxRoutes', validateMaxRoutes, () =>
                text({
                    message: 'Enter the maximum number of routes for this project:',
                    hint: 'This will be used for configuring the project.',
                    placeholder: '30',
                    validate: validateMaxRoutes,
                    defaultValue: '30',
                })
            ),
            generateReport: fromConfig(config, 'generateReport', validateBoolean, () =>
                confirm({
                    message: 'Do you want to generate an HTML report for this project?',
                })
            ),
        },
        {
            onCancel: () => {
                log.error('Operation cancelled');
                process.exit(0);
            },
        }
    );

// Crawling, screenshots and login windows need Playwright's Chromium. Check for it before anything else and offer
// to install it. Returns false when it is still missing, so the wizard can collect the details and stop before those steps.
const ensureChromium = async () => {
    const check = spinner();
    check.start('Checking for the Chromium browser');
    const installed = await isChromiumInstalled();
    check.stop(installed ? 'Chromium is installed' : 'Chromium is not installed');
    if (installed) return true;

    const install = await confirm({
        message: 'Crawling and screenshots need Chromium (about 150 MB). Install it now?',
    });
    if (isCancel(install)) {
        log.error('Operation cancelled');
        process.exit(0);
    }
    if (install) {
        // The installer prints its own download progress, so it runs without a spinner.
        log.step('Installing Chromium (npx playwright install chromium)...');
        if ((await installChromium()) && (await isChromiumInstalled())) {
            log.success('Chromium installed');
            return true;
        }
        log.error('Chromium could not be installed. Check your connection, or run: npx playwright install chromium');
    }
    log.warn(
        'Without Chromium, crawling and screenshots will not work. You can still enter the project details; ' +
            'they are saved so you can run everything later.'
    );
    return false;
};

// The config file to load: from --config, or asked for (leave empty to enter every detail by hand).
const getConfigPath = async () => {
    const { values } = parseArgs({ options: { config: { type: 'string', short: 'c' } } });
    if (values.config) return values.config;
    const answer = await text({
        message: 'Path to a saved project config (leave empty to enter the details):',
        placeholder: `projects/<name>/${CONFIG_FILE}`,
        validate: (value) => (value && !fs.existsSync(value) ? 'File not found' : undefined),
    });
    if (isCancel(answer)) {
        log.error('Operation cancelled');
        process.exit(0);
    }
    return answer || null;
};

const loadConfig = async (configPath) => {
    const config = await readJsonFile(configPath, 'Config');
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new Error(`Config file must contain a JSON object: ${configPath}`);
    }
    log.info(`Loaded project details from ${configPath}`);
    return config;
};

// Save the answers (except the password) so the next run can load them with --config.
const saveConfig = async (inputs, projectPath) => {
    const { httpPassword, ...details } = inputs;
    const configPath = path.join(projectPath, CONFIG_FILE);
    await writeJsonFile(configPath, { version: CONFIG_VERSION, ...details, maxRoutes: Number(details.maxRoutes) });
    return configPath;
};

const createProjectDir = async (dirName) => {
    //all projects will be created inside the projects directory in root
    dirName = `projects/${dirName}`;
    const fs = await import('fs');
    const path = await import('path');
    const fullPath = path.resolve(process.cwd(), dirName);
    // check if a directory with the same name already exists
    if (fs.existsSync(fullPath)) {
        log.warn(`Directory ${fullPath} already exists`);
        const shouldContinue = await confirm({
            message: 'Directory already exists. Do you want to continue? (continuing will remove all existing files in the directory)',
        });
        if (isCancel(shouldContinue) || !shouldContinue) {
            return null;
        }
    }

    if (fs.existsSync(fullPath)) {
        fs.rmSync(fullPath, { recursive: true, force: true });
    }
    // create the directory if it doesn't exist
    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
    }
    return fullPath;
};



// Each site gets its own folder inside the project directory.
const SITE_A_DIR = 'site-a';
const SITE_B_DIR = 'site-b';

// Swap the origin (protocol + host + port) of a URL, keeping its path and query.
const swapOrigin = (url, newOrigin) => {
    const parsed = new URL(url);
    return new URL(parsed.pathname + parsed.search, newOrigin).href;
};

// Site B has the same routes as Site A, so its manifest is a copy with the domain changed.
// The crawl status is kept so both sites capture the same set of pages.
const buildSiteBManifest = (siteAManifest, siteBUrl) => {
    const siteBOrigin = new URL(siteBUrl).origin;
    return {
        ...siteAManifest,
        startUrl: swapOrigin(siteAManifest.startUrl, siteBOrigin),
        routes: siteAManifest.routes.map((route) => ({ ...route, url: swapOrigin(route.url, siteBOrigin) })),
    };
};

const httpCredentialsFor = (inputs) =>
    inputs.requireAuth ? { username: inputs.httpUsername, password: inputs.httpPassword } : undefined;

const authStatePathFor = (projectPath, siteDir) => path.join(projectPath, siteDir, 'auth-state.json');

// Write routes.json for both sites: Site A's as discovered, Site B's as a copy with the domain changed.
const writeRoutes = async (inputs, projectPath, manifest) => {
    await writeJsonFile(path.join(projectPath, SITE_A_DIR, 'routes.json'), manifest);
    await writeJsonFile(path.join(projectPath, SITE_B_DIR, 'routes.json'), buildSiteBManifest(manifest, inputs.siteBUrl));
};

// Read Site A's sitemap (no browser needed). Returns the route manifest, or null when there is no usable sitemap.
// Site A's saved login session, or undefined when the site has no login.
const siteASession = (inputs, projectPath) =>
    inputs.requireLogin ? readJsonFile(authStatePathFor(projectPath, SITE_A_DIR), 'Auth state') : undefined;

// Read Site A's sitemap (no browser needed) as the logged-in user. Returns the route manifest, or null when there is no usable sitemap.
const findSitemapRoutes = async (inputs, projectPath) =>
    discoverSitemapRoutes({
        startUrl: inputs.siteAUrl,
        maxPages: Number(inputs.maxRoutes),
        httpCredentials: httpCredentialsFor(inputs),
        storageState: await siteASession(inputs, projectPath),
    });

// Crawl Site A in the background by following links, starting from the saved login session.
const crawlSiteA = async (inputs, projectPath, onProgress) =>
    crawlSite({
        startUrl: inputs.siteAUrl,
        maxPages: Number(inputs.maxRoutes),
        waitForLogin: false,
        httpCredentials: httpCredentialsFor(inputs),
        storageState: await siteASession(inputs, projectPath),
        log: onProgress,
    });

// Snapshotting a site needs the user only when login is required and there is no saved session for it.
// Site A's session is saved before route discovery; a session never carries over to Site B's domain.
const needsLoginWindow = (inputs, projectPath, siteDir) =>
    inputs.requireLogin && !fs.existsSync(authStatePathFor(projectPath, siteDir));

// Screenshot every "ok" route of one site into <site>/screenshots and write <site>/capture-manifest.json.
// Uses the site's saved session when there is one; otherwise, if login is required, opens a visible
// browser for the user to log in and captures in that window.
const snapshotSite = async (inputs, projectPath, siteDir, onProgress) => {
    const sitePath = path.join(projectPath, siteDir);
    const urls = urlsFromRouteManifest(await readJsonFile(path.join(sitePath, 'routes.json'), 'Route manifest'));
    const httpCredentials = httpCredentialsFor(inputs);

    let storageState;
    let session = null;
    if (needsLoginWindow(inputs, projectPath, siteDir)) {
        session = await loginAndKeepBrowser(urls[0], { width: 1280, height: 720 }, onProgress, httpCredentials);
    } else if (inputs.requireLogin) {
        storageState = await readJsonFile(authStatePathFor(projectPath, siteDir), 'Auth state');
    }

    let manifest;
    try {
        manifest = await captureUrls({
            urls,
            outputDir: path.join(sitePath, 'screenshots'),
            storageState,
            httpCredentials,
            context: session?.context,
            log: onProgress,
        });
    } finally {
        await session?.browser.close();
    }
    await writeJsonFile(path.join(sitePath, 'capture-manifest.json'), manifest);
    const ok = manifest.captures.filter((capture) => capture.status === 'ok').length;
    return `Captured ${ok} of ${manifest.captures.length} pages for ${siteDir}`;
};

// Compare Site A's screenshots against Site B's. Captures are paired by path because the domains differ.
const diffSites = async (projectPath) => {
    const readCaptures = (siteDir) =>
        readJsonFile(path.join(projectPath, siteDir, 'capture-manifest.json'), 'Capture manifest');
    const results = await compareManifests(await readCaptures(SITE_A_DIR), await readCaptures(SITE_B_DIR), {
        diffDir: path.join(projectPath, 'diffs'),
        matchBy: 'path',
    });
    await writeJsonFile(path.join(projectPath, 'diff-result.json'), results);
    return results;
};

// Run one step: under a spinner, or with plain log lines when the step waits for the user to press Enter.
const runStep = async (title, run, { interactive = false } = {}) => {
    if (interactive) {
        log.step(title);
        log.success(await run((message) => log.message(message)));
    } else {
        await tasks([{ title, task: run }]);
    }
};

async function main() {
    const hasChromium = await ensureChromium();
    const configPath = await getConfigPath();
    const inputs = await getInputs(configPath ? await loadConfig(configPath) : {});
    // URLs may be typed without a protocol; every later step expects a full URL.
    inputs.siteAUrl = withProtocol(inputs.siteAUrl);
    inputs.siteBUrl = withProtocol(inputs.siteBUrl);

    // Done outside the task list because it may ask for confirmation, which a spinner would hide.
    const projectPath = await createProjectDir(inputs.projectName);
    if (!projectPath) {
        log.error('Failed to create project directory.');
        process.exit(1);
    }
    log.success(`Project created at: ${projectPath}`);
    // Written after the project folder is (re)created, because recreating it removes everything inside.
    const savedConfigPath = await saveConfig(inputs, projectPath);
    log.info(`Saved project details to ${savedConfigPath}`);
    const rerunCommand = `noktra-cli --config ${path.relative(process.cwd(), savedConfigPath)}`;

    // Login, crawling and screenshots all need the browser, so stop here with the details saved.
    if (!hasChromium) {
        outro(
            'Stopped before crawling: Chromium is not installed.\n' +
                `Install it with "npx playwright install chromium", then run: ${rerunCommand}`
        );
        return;
    }

    // Log in before discovering routes: behind a login, the sitemap and pages only load for a logged-in user.
    if (inputs.requireLogin) {
        await runStep(
            'Logging in to Site A. A browser window will open; log in there, then press Enter here.',
            async (message) => {
                await saveLoginState({
                    startUrl: inputs.siteAUrl,
                    authStatePath: authStatePathFor(projectPath, SITE_A_DIR),
                    httpCredentials: httpCredentialsFor(inputs),
                    log: message,
                });
                return 'Logged in to Site A';
            },
            { interactive: true }
        );
    }

    // SPAs build their pages in the browser, so their sitemaps (if any) are unreliable; crawl them directly.
    // Every other site tries its sitemap first and is only crawled when no sitemap is found.
    let manifest = null;
    if (!inputs.isAnSPA) {
        await runStep('Looking for a sitemap on Site A', async () => {
            manifest = await findSitemapRoutes(inputs, projectPath);
            return manifest
                ? `Found ${manifest.routes.length} routes in the sitemap`
                : 'No sitemap found; Site A will be crawled instead';
        });
    }
    if (!manifest) {
        await runStep('Crawling Site A', async (message) => {
            manifest = await crawlSiteA(inputs, projectPath, message);
            const failed = manifest.routes.filter((route) => route.status === 'error').length;
            return `Discovered ${manifest.routes.length} routes on Site A (${failed} failed)`;
        });
    }
    await writeRoutes(inputs, projectPath, manifest);

    for (const [siteDir, siteName] of [[SITE_A_DIR, 'Site A'], [SITE_B_DIR, 'Site B']]) {
        const interactive = needsLoginWindow(inputs, projectPath, siteDir);
        await runStep(
            interactive
                ? `Capturing screenshots of ${siteName}. A browser window will open; log in there, then press Enter here.`
                : `Capturing screenshots of ${siteName}`,
            (message) => snapshotSite(inputs, projectPath, siteDir, message),
            { interactive }
        );
    }

    let results;
    await runStep('Comparing Site A with Site B', async () => {
        results = await diffSites(projectPath);
        const passed = results.filter((result) => result.passed).length;
        return `${passed} of ${results.length} pages match. Wrote diff-result.json`;
    });

    if (inputs.generateReport) {
        const reportPath = path.join(projectPath, 'report.html');
        await runStep('Generating HTML report', async () => {
            await writeHtmlReport(reportPath, results);
            return `Wrote ${reportPath}`;
        });
    }

    outro(`Done. Results are in ${projectPath}\nRerun without retyping: ${rerunCommand}`);
}

main().catch((error) => {
    log.error(error.message);
    process.exit(1);
});
