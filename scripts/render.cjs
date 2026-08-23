#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SKILL_ROOT = path.resolve(__dirname, '..');
const MERMAID_RUNTIME = path.join(SKILL_ROOT, 'assets', 'mermaid.min.js');
const CJK_FONT = path.join(SKILL_ROOT, 'assets', 'NotoSansSC.ttf');

function usage() {
  process.stdout.write(`Usage:
  node scripts/render.cjs <input.mmd|input.svg> [options]

Options:
  --out-dir <dir>       Output directory (default: input directory)
  --scale <number>      PNG device scale, 1-4 (default: 2)
  --browser <path>      Chromium/Chrome executable
  --background <value>  transparent or a CSS color (default: transparent)
  --width <px>          Override PNG CSS width while keeping SVG unchanged
  --height <px>         Override PNG CSS height while keeping SVG unchanged
  --help                Show this help
`);
}

function fail(message) {
  const error = new Error(message);
  error.name = 'RenderMermaidError';
  throw error;
}

function parsePositiveNumber(value, option, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    fail(`${option} must be between ${minimum} and ${maximum}; received ${value}`);
  }
  return number;
}

function parseArgs(argv) {
  const options = {
    input: undefined,
    outDir: undefined,
    scale: 2,
    browser: undefined,
    background: 'transparent',
    width: undefined,
    height: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--help' || value === '-h') {
      usage();
      process.exit(0);
    }
    if (!value.startsWith('-') && !options.input) {
      options.input = value;
      continue;
    }
    const next = () => {
      index += 1;
      if (index >= argv.length) fail(`${value} requires a value`);
      return argv[index];
    };
    if (value === '--out-dir') options.outDir = next();
    else if (value === '--scale') options.scale = parsePositiveNumber(next(), '--scale', 1, 4);
    else if (value === '--browser') options.browser = next();
    else if (value === '--background') options.background = next();
    else if (value === '--width') options.width = parsePositiveNumber(next(), '--width', 16, 16000);
    else if (value === '--height') options.height = parsePositiveNumber(next(), '--height', 16, 16000);
    else fail(`unknown argument: ${value}`);
  }

  if (!options.input) fail('an input .mmd or .svg file is required');
  if (!/^(transparent|#[0-9a-f]{3,8}|[a-z]+|rgba?\([0-9.,% ]+\)|hsla?\([0-9.,% deg]+\))$/i.test(options.background)) {
    fail(`--background is not a safe CSS color: ${options.background}`);
  }
  return options;
}

function requirePlaywright() {
  try {
    return require('playwright');
  } catch (firstError) {
    const modules = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
    if (modules) {
      try {
        return require(path.join(modules, 'playwright'));
      } catch {
        // Report the original, more useful error below.
      }
    }
    fail(`Playwright is unavailable. Install it with npm or run inside the Codex primary runtime. ${firstError.message}`);
  }
}

function isExecutable(file) {
  if (!file) return false;
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function commandPath(command) {
  try {
    const value = execFileSync('which', [command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return isExecutable(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function workspaceBrowsers() {
  const matches = [];
  const roots = [process.cwd(), '/workspace/scratch'];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    try {
      const result = execFileSync('find', [
        root,
        '-type', 'f',
        '(', '-name', 'chrome-headless-shell', '-o', '-name', 'chrome', '-o', '-name', 'chromium', ')',
        '-perm', '-u+x',
        '-print',
      ], { encoding: 'utf8', timeout: 12000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      for (const file of result.split(/\r?\n/).filter(Boolean).slice(0, 24)) {
        if (isExecutable(file)) matches.push(file);
      }
    } catch {
      // Continue to the next bounded search root.
    }
  }
  return matches;
}

function locateBrowsers(chromium, explicit) {
  if (explicit) {
    if (!isExecutable(explicit)) fail(`browser is not executable: ${path.resolve(explicit)}`);
    return [path.resolve(explicit)];
  }
  const candidates = [
    process.env.MERMAID_BROWSER_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  ];
  try {
    candidates.push(chromium.executablePath());
  } catch {
    // Playwright can still launch with an explicitly discovered browser.
  }
  for (const command of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome-headless-shell']) {
    candidates.push(commandPath(command));
  }
  candidates.push(...workspaceBrowsers());
  const browsers = [...new Set(candidates.filter(isExecutable).map((file) => path.resolve(file)))];
  if (!browsers.length) {
    fail('no Chromium executable found. Pass --browser /absolute/path/to/chrome-headless-shell or set MERMAID_BROWSER_PATH');
  }
  return browsers;
}

async function launchBrowser(chromium, candidates) {
  const failures = [];
  for (const executablePath of candidates) {
    try {
      const browser = await chromium.launch({
        executablePath,
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files'],
      });
      return { browser, executablePath };
    } catch (error) {
      failures.push(`${executablePath}: ${String(error.message || error).split('\n')[0]}`);
    }
  }
  fail(`discovered Chromium executables could not start:\n${failures.join('\n')}`);
}

function scaleLabel(scale) {
  return Number.isInteger(scale) ? String(scale) : String(scale).replace('.', '_');
}

function ensureInput(input) {
  const absolute = path.resolve(input);
  if (!fs.existsSync(absolute)) fail(`input does not exist: ${absolute}`);
  if (!fs.statSync(absolute).isFile()) fail(`input is not a file: ${absolute}`);
  const extension = path.extname(absolute).toLowerCase();
  if (!['.mmd', '.svg'].includes(extension)) fail(`input must end in .mmd or .svg: ${absolute}`);
  return { absolute, extension };
}

async function renderMmd(page, source) {
  if (!fs.existsSync(MERMAID_RUNTIME)) fail(`missing vendored Mermaid runtime: ${MERMAID_RUNTIME}`);
  await page.setContent('<!doctype html><meta charset="utf-8"><body></body>', { waitUntil: 'load' });
  await page.addScriptTag({ path: MERMAID_RUNTIME });

  return page.evaluate(async ({ diagram }) => {
    if (!globalThis.mermaid) throw new Error('Mermaid runtime did not initialize');
    globalThis.mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: 'Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif',
      flowchart: {
        htmlLabels: false,
        curve: 'basis',
        nodeSpacing: 42,
        rankSpacing: 70,
        padding: 20,
        useMaxWidth: false,
      },
      themeVariables: {
        background: 'transparent',
        primaryColor: '#FFFFFF',
        primaryTextColor: '#202938',
        primaryBorderColor: '#D7DEE8',
        secondaryColor: '#EAF2FF',
        tertiaryColor: '#F7F8FA',
        lineColor: '#98A2B3',
        textColor: '#202938',
        mainBkg: '#FFFFFF',
        secondBkg: '#EAF2FF',
        clusterBkg: '#F7F8FA',
        clusterBorder: '#D7DEE8',
        edgeLabelBackground: '#FFFFFF',
        fontSize: '17px',
      },
    });

    const id = `render-mermaid-${Math.random().toString(36).slice(2)}`;
    const result = await globalThis.mermaid.render(id, diagram);
    const documentNode = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
    const parserError = documentNode.querySelector('parsererror');
    if (parserError) throw new Error(parserError.textContent || 'Rendered SVG is invalid');
    const root = documentNode.documentElement;
    const viewBox = (root.getAttribute('viewBox') || '').trim().split(/[ ,]+/).map(Number);
    if (viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value))) {
      throw new Error('Rendered SVG has no valid viewBox');
    }

    root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    root.setAttribute('width', String(Math.ceil(viewBox[2])));
    root.setAttribute('height', String(Math.ceil(viewBox[3])));
    root.setAttribute('role', 'img');
    root.setAttribute('style', 'max-width:none;background:transparent;');

    const style = documentNode.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.setAttribute('id', 'render-mermaid-claude-like');
    style.textContent = `
      svg { background: transparent !important; }
      text, .nodeLabel, .edgeLabel, .cluster-label {
        font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif !important;
        text-rendering: geometricPrecision;
      }
      .node rect { rx: 16px; ry: 16px; }
      .cluster rect { rx: 24px; ry: 24px; fill-opacity: .82; }
      .node rect, .node circle, .node ellipse, .node polygon, .node path {
        stroke-linejoin: round;
        filter: drop-shadow(0 4px 8px rgba(15, 23, 42, .08));
      }
      .flowchart-link, .edge-pattern-solid, .edge-pattern-dashed {
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .edgeLabel .label, .edgeLabel rect, .labelBkg { rx: 12px; ry: 12px; }
    `;
    root.appendChild(style);
    return new XMLSerializer().serializeToString(root);
  }, { diagram: source });
}

function numericDimension(value) {
  if (!value) return undefined;
  const match = String(value).trim().match(/^([0-9]+(?:\.[0-9]+)?)(?:px)?$/i);
  return match ? Number(match[1]) : undefined;
}

function dimensionsFromSvg(svg) {
  const viewBoxMatch = svg.match(/\bviewBox\s*=\s*["']([^"']+)["']/i);
  const viewBox = viewBoxMatch ? viewBoxMatch[1].trim().split(/[ ,]+/).map(Number) : [];
  const widthMatch = svg.match(/<svg\b[^>]*\bwidth\s*=\s*["']([^"']+)["']/i);
  const heightMatch = svg.match(/<svg\b[^>]*\bheight\s*=\s*["']([^"']+)["']/i);
  const width = numericDimension(widthMatch?.[1]) ?? viewBox[2];
  const height = numericDimension(heightMatch?.[1]) ?? viewBox[3];
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    fail('SVG must have positive numeric width/height or a valid viewBox');
  }
  return { width: Math.ceil(width), height: Math.ceil(height) };
}

function assertSafeSvg(svg) {
  const forbidden = [
    /<\s*(script|iframe|object|embed|foreignObject)\b/i,
    /\son[a-z]+\s*=/i,
    /(?:href|src)\s*=\s*["']\s*(?:javascript:|https?:|\/\/)/i,
    /@import\b/i,
    /url\(\s*["']?\s*(?:https?:|\/\/)/i,
  ];
  if (forbidden.some((pattern) => pattern.test(svg))) {
    fail('SVG contains active or external content; remove scripts, event handlers, foreign objects, and remote URLs before rendering');
  }
}

function fontStyle() {
  if (!fs.existsSync(CJK_FONT)) return '';
  const data = fs.readFileSync(CJK_FONT).toString('base64');
  return `@font-face{font-family:"Noto Sans SC";src:url(data:font/ttf;base64,${data}) format("truetype");font-style:normal;font-weight:100 900;font-display:block;}`;
}

async function renderSvg(browser, svg, output, options) {
  assertSafeSvg(svg);
  const natural = dimensionsFromSvg(svg);
  let cssWidth = options.width;
  let cssHeight = options.height;
  if (cssWidth && !cssHeight) cssHeight = cssWidth * natural.height / natural.width;
  if (cssHeight && !cssWidth) cssWidth = cssHeight * natural.width / natural.height;
  cssWidth = Math.ceil(cssWidth ?? natural.width);
  cssHeight = Math.ceil(cssHeight ?? natural.height);
  if (cssWidth * options.scale > 32000 || cssHeight * options.scale > 32000) {
    fail('scaled PNG dimensions exceed the 32,000 pixel browser limit');
  }

  const context = await browser.newContext({
    viewport: { width: cssWidth, height: cssHeight },
    deviceScaleFactor: options.scale,
    colorScheme: 'light',
  });
  await context.route('**/*', (route) => route.abort());
  const page = await context.newPage();
  const background = options.background === 'transparent' ? 'transparent' : options.background;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${cssWidth}px;height:${cssHeight}px;overflow:hidden;background:${background};}
    body>svg{display:block;width:${cssWidth}px!important;height:${cssHeight}px!important;}
    ${fontStyle()}
  </style></head><body>${svg}</body></html>`;
  await page.setContent(html, { waitUntil: 'load', timeout: 120000 });
  await page.evaluate(async () => document.fonts.ready);

  const audit = await page.evaluate(() => {
    const root = document.querySelector('svg');
    if (!root) throw new Error('No SVG root found');
    const rootRect = root.getBoundingClientRect();
    const tolerance = 1.5;
    const text = [...root.querySelectorAll('text')];
    const zeroSizeText = [];
    const clippedText = [];
    for (const element of text) {
      const rect = element.getBoundingClientRect();
      const label = (element.textContent || '').trim();
      if (!rect.width || !rect.height) zeroSizeText.push(label);
      if (
        rect.left < rootRect.left - tolerance ||
        rect.top < rootRect.top - tolerance ||
        rect.right > rootRect.right + tolerance ||
        rect.bottom > rootRect.bottom + tolerance
      ) clippedText.push(label);
    }
    return {
      textCount: text.length,
      nodeCount: root.querySelectorAll('[data-node], .node').length,
      groupCount: root.querySelectorAll('[data-group], .cluster').length,
      edgeCount: root.querySelectorAll('.flowchart-link, path.edge').length,
      zeroSizeText,
      clippedText,
      fontLoaded: document.fonts.check('16px "Noto Sans SC"'),
      cssWidth: Math.round(rootRect.width),
      cssHeight: Math.round(rootRect.height),
    };
  });

  if (audit.zeroSizeText.length) {
    await context.close();
    fail(`zero-size text detected: ${JSON.stringify(audit.zeroSizeText)}`);
  }
  if (audit.clippedText.length) {
    await context.close();
    fail(`clipped text detected: ${JSON.stringify(audit.clippedText)}`);
  }

  await page.screenshot({
    path: output,
    clip: { x: 0, y: 0, width: cssWidth, height: cssHeight },
    omitBackground: options.background === 'transparent',
    timeout: 120000,
  });
  await context.close();
  return {
    ...audit,
    pixelWidth: Math.round(cssWidth * options.scale),
    pixelHeight: Math.round(cssHeight * options.scale),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const input = ensureInput(options.input);
  const outDir = path.resolve(options.outDir || path.dirname(input.absolute));
  fs.mkdirSync(outDir, { recursive: true });
  const stem = path.basename(input.absolute, input.extension);
  const svgOutput = path.join(outDir, `${stem}.svg`);
  const pngOutput = path.join(outDir, `${stem}-${scaleLabel(options.scale)}x.png`);
  const { chromium } = requirePlaywright();
  const candidates = locateBrowsers(chromium, options.browser);
  const { browser, executablePath } = await launchBrowser(chromium, candidates);

  try {
    let svg;
    if (input.extension === '.mmd') {
      const source = fs.readFileSync(input.absolute, 'utf8');
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      try {
        svg = await renderMmd(page, source);
      } finally {
        await page.close();
      }
      fs.writeFileSync(svgOutput, `${svg}\n`, 'utf8');
    } else {
      svg = fs.readFileSync(input.absolute, 'utf8');
    }

    const audit = await renderSvg(browser, svg, pngOutput, options);
    const result = {
      input: input.absolute,
      svg: input.extension === '.mmd' ? svgOutput : input.absolute,
      png: pngOutput,
      browser: executablePath,
      scale: options.scale,
      background: options.background,
      ...audit,
      bytes: fs.statSync(pngOutput).size,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  const output = error.name === 'RenderMermaidError'
    ? `render-mermaid: ${error.message}`
    : (error.stack || error.message);
  process.stderr.write(`${output}\n`);
  process.exitCode = 1;
});
