import fs from 'node:fs';
import path from 'node:path';
import { group, text, password, log, isCancel, tasks, confirm, outro } from '@clack/prompts';
import { crawlSite, discoverSitemapRoutes, withProtocol, writeJsonFile } from 'noktra-crawler-engine';
import { captureUrls, loginAndKeepBrowser, readJsonFile, urlsFromRouteManifest } from 'noktra-snapshot-engine';
import { compareManifests } from 'noktra-diff-engine';
import { writeHtmlReport } from 'noktra-diff-engine/report';

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

const getInputs = () =>
    group(
        {
            projectName: () =>
                text({
                    message: 'Enter your project name:',
                    hint: 'A folder will be created in the projects directory with this name.',
                    validate: (value) => {
                        if (!value || value.length < 2) return 'Name must be at least 2 characters';
                        return undefined;
                    },
                }),
            siteAUrl: () =>
                text({
                    message: 'Enter the URL for Site A:',
                    hint: 'This will be used for configuring the project.',
                    validate: validateUrl,
                }),
            siteBUrl: () =>
                text({
                    message: 'Enter the URL for Site B:',
                    hint: 'This will be used for configuring the project.',
                    validate: validateUrl,
                }),
            requireAuth: () =>
                confirm({
                    message: 'Does this project require HTTP authentication?',
                }),
            httpUsername: ({ results }) =>
                results.requireAuth
                    ? text({
                          message: 'HTTP authentication username:',
                          validate: (value) => (!value ? 'Username is required' : undefined),
                      })
                    : undefined,
            httpPassword: ({ results }) =>
                results.requireAuth
                    ? password({
                          message: 'HTTP authentication password:',
                          validate: (value) => (!value ? 'Password is required' : undefined),
                      })
                    : undefined,
            requireLogin: () =>
                confirm({
                    message: 'Does this project require login?',
                }),
            isAnSPA: () =>
                confirm({
                    message: 'Is this project a Single Page Application (SPA)?',
                }),
            maxRoutes: () =>
                text({
                    message: 'Enter the maximum number of routes for this project:',
                    hint: 'This will be used for configuring the project.',
                    placeholder: '30',
                    validate: (value) => {
                        // clack validates before applying defaultValue, so an empty answer must pass here
                        if (!value) return undefined;
                        const number = parseInt(value, 10);
                        if (isNaN(number) || number <= 0) return 'Please enter a valid number greater than 0';
                        return undefined;
                    },
                    defaultValue: '30',
                }),
            generateReport: () =>
                confirm({
                    message: 'Do you want to generate an HTML report for this project?',
                }),
        },
        {
            onCancel: () => {
                log.error('Operation cancelled');
                process.exit(0);
            },
        }
    );

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
const findSitemapRoutes = (inputs) =>
    discoverSitemapRoutes({
        startUrl: inputs.siteAUrl,
        maxPages: Number(inputs.maxRoutes),
        httpCredentials: httpCredentialsFor(inputs),
    });

// Crawl Site A by following links in a browser (saving auth-state.json if login is needed).
const crawlSiteA = (inputs, projectPath, onProgress) =>
    crawlSite({
        startUrl: inputs.siteAUrl,
        maxPages: Number(inputs.maxRoutes),
        waitForLogin: inputs.requireLogin,
        authStatePath: inputs.requireLogin ? authStatePathFor(projectPath, SITE_A_DIR) : undefined,
        httpCredentials: httpCredentialsFor(inputs),
        log: onProgress,
    });

// Snapshotting a site needs the user only when login is required and there is no saved session for it.
// The crawler saves Site A's session; a session never carries over to Site B's domain.
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
    const inputs = await getInputs();
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

    // SPAs build their pages in the browser, so their sitemaps (if any) are unreliable; crawl them directly.
    // Every other site tries its sitemap first and is only crawled when no sitemap is found.
    let manifest = null;
    if (!inputs.isAnSPA) {
        await runStep('Looking for a sitemap on Site A', async () => {
            manifest = await findSitemapRoutes(inputs);
            return manifest
                ? `Found ${manifest.routes.length} routes in the sitemap`
                : 'No sitemap found; Site A will be crawled instead';
        });
    }
    if (!manifest) {
        await runStep(
            inputs.requireLogin
                ? 'Crawling Site A. A browser window will open; log in there, then press Enter here.'
                : 'Crawling Site A',
            async (message) => {
                manifest = await crawlSiteA(inputs, projectPath, message);
                const failed = manifest.routes.filter((route) => route.status === 'error').length;
                return `Discovered ${manifest.routes.length} routes on Site A (${failed} failed)`;
            },
            { interactive: inputs.requireLogin }
        );
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

    outro(`Done. Results are in ${projectPath}`);
}

main().catch((error) => {
    log.error(error.message);
    process.exit(1);
});
