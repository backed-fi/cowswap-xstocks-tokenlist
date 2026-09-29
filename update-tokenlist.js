const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const API_URL = 'https://api.xstocks.fi/api/v2/public/assets';
const API_PAGE_SIZE = 100;
// All xStocks EVM tokens use 18 decimals; the API does not expose this field
const XSTOCKS_DECIMALS = 18;

async function fetchAllAssets() {
  const allAssets = [];
  let page = 0;

  while (true) {
    const url = `${API_URL}?supportsAtomicSwaps=true&page=${page}&pageSize=${API_PAGE_SIZE}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    allAssets.push(...data.nodes);
    if (!data.page.hasNextPage) break;
    page++;
  }

  return allAssets;
}

// Local, gitignored file of Private (pre-IPO) assets the public API does not
// return yet, keyed by symbol. See preseed.example.json for the format.
const PRESEED_PATH = path.join(__dirname, 'preseed.json');

/**
 * Look up assets by ticker in preseed.json (same shape as the public API's
 * assets: name, symbol, deployments[])
 */
function loadPreseededAssets(tickers) {
  if (!fs.existsSync(PRESEED_PATH)) {
    throw new Error('preseed.json not found - create it from preseed.example.json before passing tickers');
  }
  const preseed = JSON.parse(fs.readFileSync(PRESEED_PATH, 'utf8'));
  return tickers.map(ticker => {
    if (!Object.hasOwn(preseed, ticker)) {
      throw new Error(`${ticker} not found in preseed.json - add it (see preseed.example.json)`);
    }
    return preseed[ticker];
  });
}

function transformAssetsToTokens(assets) {
  const tokens = [];
  // Dedupe on chainId + address so a preseeded asset is not duplicated once
  // the public API also returns it (first occurrence wins)
  const seen = new Set();

  for (const asset of assets) {
    for (const deployment of asset.deployments) {
      if (!deployment.supportsAtomicSwaps) continue;
      const chainId = CHAIN_IDS[deployment.network];
      if (chainId === undefined) continue;
      const key = `${chainId}-${deployment.address.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      tokens.push({
        chainId,
        address: deployment.address,
        name: asset.name,
        symbol: asset.symbol,
        decimals: XSTOCKS_DECIMALS,
        logoURI: asset.logo,
        tags: ['xStocks']
      });
    }
  }

  return tokens;
}

// The Uniswap token-lists schema caps a list at 10,000 tokens. CowSwap is
// deciding how to handle the cap; until then, new entries beyond it are deferred.
const MAX_TOKENS = 10000;

/**
 * Keep the list within MAX_TOKENS. Entries already in the list and the
 * keepSymbols (preseeded tickers) always stay; new entries are added a whole
 * symbol at a time, oldest asset first (the API returns newest first), until
 * the cap is reached.
 */
function capTokens(tokens, existingTokens, keepSymbols) {
  if (tokens.length <= MAX_TOKENS) return { tokens, deferred: [] };

  const key = t => `${t.chainId}-${t.address.toLowerCase()}`;
  const existing = new Set(existingTokens.map(key));
  const isKept = t => existing.has(key(t)) || keepSymbols.includes(t.symbol);
  let budget = MAX_TOKENS - tokens.filter(isKept).length;

  const newBySymbol = new Map();
  for (const token of tokens) {
    if (isKept(token)) continue;
    newBySymbol.set(token.symbol, [...(newBySymbol.get(token.symbol) || []), token]);
  }

  const included = new Set();
  for (const [symbol, entries] of [...newBySymbol].reverse()) {
    if (entries.length > budget) break;
    budget -= entries.length;
    included.add(symbol);
  }

  const isIncluded = t => isKept(t) || included.has(t.symbol);
  return {
    tokens: tokens.filter(isIncluded),
    deferred: tokens.filter(t => !isIncluded(t))
  };
}

// The Uniswap token-lists schema caps names at 60 characters
const MAX_NAME_LENGTH = 60;

/**
 * Shorten names over MAX_NAME_LENGTH: drop the " xStock" suffix, then cut back
 * to the last whole word if it is still too long
 */
function shortenName(name) {
  if (name.length <= MAX_NAME_LENGTH) return name;
  const base = name.replace(/ xStock$/, '');
  if (base.length <= MAX_NAME_LENGTH) return base;
  // Look one character past the limit so a word ending exactly at it is kept
  const cut = base.slice(0, MAX_NAME_LENGTH + 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut.slice(0, MAX_NAME_LENGTH)).trim();
}

const LOGO_CHECK_CONCURRENCY = 20;

async function checkLogoURIs(tokens) {
  const uniqueLogos = new Map();
  for (const token of tokens) {
    if (!uniqueLogos.has(token.symbol)) {
      uniqueLogos.set(token.symbol, token.logoURI);
    }
  }

  console.log(`\nChecking ${uniqueLogos.size} logo URIs...`);

  const checkLogo = async ([symbol, url], retries = 1) => {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      return { symbol, url, ok: response.ok, status: response.status };
    } catch (err) {
      if (retries > 0) return checkLogo([symbol, url], retries - 1);
      return { symbol, url, ok: false, status: 'network error' };
    }
  };

  // Check a limited number at a time: firing ~1,400 requests at once makes the
  // logo host drop connections, which showed up as false "network error"s
  const queue = [...uniqueLogos.entries()];
  const results = [];
  await Promise.all(Array.from({ length: LOGO_CHECK_CONCURRENCY }, async () => {
    while (queue.length > 0) {
      results.push(await checkLogo(queue.shift()));
    }
  }));

  const broken = results.filter(r => !r.ok).sort((a, b) => a.symbol.localeCompare(b.symbol));

  if (broken.length === 0) {
    console.log('All logo URIs are valid.');
  } else {
    const symbols = broken.map(b => `${b.symbol} (${b.status})`).join(', ');
    console.log(`Broken logo URIs (${broken.length}, full URLs in README.md): ${symbols}`);
  }

  return broken;
}

const TOKENLIST_PATH = path.join(__dirname, 'tokenlist.json');
const SCHEMA_PATH = path.join(__dirname, 'node_modules/@uniswap/token-lists/src/tokenlist.schema.json');

/**
 * Validate token list against Uniswap token-lists schema
 */
function isValidTokenList(tokenList) {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const valid = validate(tokenList);
  if (valid) return true;
  return validate.errors;
}

const CHAIN_IDS = {
  Ink: 57073,
  HyperEVM: 999,
  Mantle: 5000,
  Tron: 728126428,
  Sonic: 146,
  Etherlink: 42793,
  Lisk: 1135,
  Base: 8453,
  Fantom: 250,
  Avalanche: 43114,
  Arbitrum: 42161,
  BinanceSmartChain: 56,
  Gnosis: 100,
  Polygon: 137,
  Ethereum: 1,
  XLayer: 196,
  Optimism: 10,
  Monad: 143
};

// Reverse lookup: chainId -> network name
const CHAIN_NAMES = Object.fromEntries(
  Object.entries(CHAIN_IDS).map(([name, id]) => [id, name])
);

/**
 * Format token as short string: symbol:network
 */
function formatTokenShort(token) {
  const network = CHAIN_NAMES[token.chainId] || `chain-${token.chainId}`;
  return `${token.symbol}:${network}`;
}

/**
 * Calculate semantic version bump and diff summary based on token changes
 * @param {Array} oldTokens - Previous token list
 * @param {Array} newTokens - New token list
 * @param {Object} currentVersion - Current version {major, minor, patch}
 * @returns {Object} { newVersion, summary }
 */
function calculateVersionBump(oldTokens, newTokens, currentVersion) {
  const oldTokenKeys = new Set(
    oldTokens.map(t => `${t.chainId}-${t.address.toLowerCase()}`)
  );
  const newTokenKeys = new Set(
    newTokens.map(t => `${t.chainId}-${t.address.toLowerCase()}`)
  );

  const oldTokenMap = new Map(
    oldTokens.map(t => [`${t.chainId}-${t.address.toLowerCase()}`, t])
  );
  const newTokenMap = new Map(
    newTokens.map(t => [`${t.chainId}-${t.address.toLowerCase()}`, t])
  );

  // Count removals (triggers major bump) - format as short strings
  const removed = [];
  for (const key of oldTokenKeys) {
    if (!newTokenKeys.has(key)) {
      removed.push(formatTokenShort(oldTokenMap.get(key)));
    }
  }

  // Count additions (triggers minor bump) - format as short strings
  const added = [];
  for (const key of newTokenKeys) {
    if (!oldTokenKeys.has(key)) {
      added.push(formatTokenShort(newTokenMap.get(key)));
    }
  }

  // Count modifications (triggers patch bump) - format as before/after records
  const modified = [];
  for (const [key, newToken] of newTokenMap) {
    const oldToken = oldTokenMap.get(key);
    if (oldToken) {
      const changes = {};
      if (oldToken.name !== newToken.name) {
        changes.name = { before: oldToken.name, after: newToken.name };
      }
      if (oldToken.symbol !== newToken.symbol) {
        changes.symbol = { before: oldToken.symbol, after: newToken.symbol };
      }
      if (oldToken.logoURI !== newToken.logoURI) {
        changes.logoURI = { before: oldToken.logoURI, after: newToken.logoURI };
      }
      if (oldToken.decimals !== newToken.decimals) {
        changes.decimals = { before: oldToken.decimals, after: newToken.decimals };
      }
      if (Object.keys(changes).length > 0) {
        modified.push({
          token: formatTokenShort(newToken),
          changes
        });
      }
    }
  }

  // Build version bump reasons (can be simultaneous)
  const reasons = [];
  if (removed.length > 0) reasons.push(`major: ${removed.length} token(s) removed`);
  if (added.length > 0) reasons.push(`minor: ${added.length} token(s) added`);
  if (modified.length > 0) reasons.push(`patch: ${modified.length} token(s) modified`);

  // Calculate new version - highest precedence wins for actual bump
  const newVersion = { ...currentVersion };

  if (removed.length > 0) {
    newVersion.major += 1;
    newVersion.minor = 0;
    newVersion.patch = 0;
  } else if (added.length > 0) {
    newVersion.minor += 1;
    newVersion.patch = 0;
  } else if (modified.length > 0) {
    newVersion.patch += 1;
  }

  const versionBumpReason = reasons.length > 0 ? reasons.join('; ') : 'none';

  return {
    newVersion,
    summary: {
      added: added.length,
      removed: removed.length,
      modified: modified.length,
      addedTokens: added,
      removedTokens: removed,
      modifiedTokens: modified,
      versionBumpReason
    }
  };
}

/**
 * Analyze which symbols are missing on certain networks
 * Returns a map of symbol -> array of networks it's missing from
 */
function analyzeNetworkCoverage(tokens) {
  // Group tokens by symbol
  const symbolToChains = new Map();
  tokens.forEach(token => {
    if (!symbolToChains.has(token.symbol)) {
      symbolToChains.set(token.symbol, new Set());
    }
    symbolToChains.get(token.symbol).add(token.chainId);
  });

  // Get all networks that have at least one token
  const allNetworks = new Set(tokens.map(t => t.chainId));


  // Find symbols that are not on all networks
  const missingByNetwork = {};
  for (const chainId of allNetworks) {
    const networkName = CHAIN_NAMES[chainId] || `Chain-${chainId}`;
    const missingSymbols = [];

    for (const [symbol, chains] of symbolToChains) {
      if (!chains.has(chainId)) {
        // Find which networks DO have this symbol
        const presentOn = Array.from(chains)
          .map(id => CHAIN_NAMES[id] || `Chain-${id}`)
          .sort();
        missingSymbols.push({ symbol, presentOn });
      }
    }

    if (missingSymbols.length > 0) {
      missingByNetwork[networkName] = missingSymbols;
    }
  }

  return { missingByNetwork, totalSymbols: symbolToChains.size };
}

/**
 * Update README.md with current token statistics and broken logo URIs
 */
function updateReadme(tokens, brokenLogos = []) {
  const readmePath = path.join(__dirname, 'README.md');

  if (!fs.existsSync(readmePath)) {
    console.log('README.md not found, skipping update');
    return;
  }

  let readme = fs.readFileSync(readmePath, 'utf8');

  // Calculate token counts per network
  const countPerChain = tokens.reduce((acc, token) => {
    const name = CHAIN_NAMES[token.chainId] || `Chain-${token.chainId}`;
    acc[name] = (acc[name] || 0) + 1;
    return acc;
  }, {});

  // Analyze network coverage
  const { missingByNetwork, totalSymbols } = analyzeNetworkCoverage(tokens);

  // Build new statistics table
  let statsTable = '| Network | Tokens |\n|---------|--------|\n';
  Object.entries(countPerChain)
    .sort((a, b) => b[1] - a[1])
    .forEach(([name, count]) => {
      statsTable += `| ${name} | ${count} |\n`;
    });
  statsTable += `|---------|--------|\n`;
  statsTable += `| **Total** | **${tokens.length}** |`;

  // Build network coverage section if there are missing tokens
  let coverageSection = '';
  if (Object.keys(missingByNetwork).length > 0) {
    coverageSection = '\n\n### Network Coverage Gaps\n\n';
    coverageSection += `Unique symbols: ${totalSymbols}\n\n`;

    const sortedNetworks = Object.entries(missingByNetwork)
      .sort((a, b) => b[1].length - a[1].length);

    for (const [network, missing] of sortedNetworks) {
      const symbols = missing.map(m => m.symbol).join(', ');
      coverageSection += `- **${network}** missing ${missing.length}: ${symbols}\n`;
    }
  }

  // Build broken logo URIs section
  let brokenSection = '';
  if (brokenLogos.length > 0) {
    brokenSection = '\n\n### Broken Logo URIs\n\n';
    brokenLogos.forEach(b => {
      brokenSection += `- **${b.symbol}**: ${b.url}\n`;
    });
  }

  // Replace the statistics table in README (handle both \n and \r\n line endings).
  // The coverage gaps lookahead stops before Broken Logo URIs so both sections
  // are consumed and rewritten together in a single pass.
  const statsPattern = /## Token Statistics\r?\n\r?\n\| Network \| Tokens \|\r?\n\|[-]+\|[-]+\|\r?\n[\s\S]*?(\|[-]+\|[-]+\|\r?\n)?\| \*\*Total\*\* \| \*\*\d+\*\* \|(\r?\n\r?\n### Network Coverage Gaps\r?\n\r?\n[\s\S]*?(?=\r?\n\r?\n##|\r?\n\r?\n### Broken Logo URIs|\r?\n\r?\n$|$))?(\r?\n\r?\n### Broken Logo URIs\r?\n\r?\n[\s\S]*?(?=\r?\n\r?\n##|\r?\n\r?\n$|$))?/;

  if (statsPattern.test(readme)) {
    readme = readme.replace(statsPattern, `## Token Statistics\n\n${statsTable}${coverageSection}${brokenSection}`);
    fs.writeFileSync(readmePath, readme);
    console.log('Updated README.md');
  } else {
    console.log('Token Statistics section not found in README.md, skipping update');
  }

  // Log coverage gap counts to console (README.md has the full symbol lists)
  if (Object.keys(missingByNetwork).length > 0) {
    const gaps = Object.entries(missingByNetwork)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([network, missing]) => `${network} ${missing.length}`)
      .join(', ');
    console.log(`\nNetwork coverage gaps (of ${totalSymbols} symbols, full lists in README.md): ${gaps}`);
  }
}

/**
 * Append entry to CHANGELOG.md
 */
function appendChangelog(version, summary, timestamp) {
  const changelogPath = path.join(__dirname, 'CHANGELOG.md');
  const header = '# Changelog\n\nAll notable changes to the xStocks Token List.\n\n';

  let existingEntries = '';
  if (fs.existsSync(changelogPath)) {
    const changelog = fs.readFileSync(changelogPath, 'utf8');
    // Extract everything after the header
    const headerPattern = /^# Changelog\n\nAll notable changes to the xStocks Token List\.\n\n/;
    existingEntries = changelog.replace(headerPattern, '');
  }

  const versionStr = `${version.major}.${version.minor}.${version.patch}`;
  const date = timestamp.split('T')[0];

  let entry = `## [${versionStr}] - ${date}\n\n`;

  if (summary.added > 0) {
    entry += `### Added\n`;
    summary.addedTokens.forEach(t => {
      entry += `- ${t}\n`;
    });
    entry += '\n';
  }

  if (summary.removed > 0) {
    entry += `### Removed\n`;
    summary.removedTokens.forEach(t => {
      entry += `- ${t}\n`;
    });
    entry += '\n';
  }

  if (summary.modified > 0) {
    entry += `### Changed\n`;
    summary.modifiedTokens.forEach(m => {
      const changeDetails = Object.entries(m.changes)
        .map(([field, { before, after }]) => `${field}: "${before}" → "${after}"`)
        .join(', ');
      entry += `- ${m.token}: ${changeDetails}\n`;
    });
    entry += '\n';
  }

  const newChangelog = header + entry + existingEntries;

  fs.writeFileSync(changelogPath, newChangelog);
  console.log(`Updated CHANGELOG.md`);
}

/**
 * Summarize "SYMBOL:Network" entries (or modified records) by symbol for the
 * console, e.g. "ANTx (7), KSTRx (7: name)". CHANGELOG.md has the full detail.
 */
function summarizeBySymbol(entries) {
  const bySymbol = new Map();
  for (const entry of entries) {
    const [symbol] = (entry.token || entry).split(':');
    const group = bySymbol.get(symbol) || { count: 0, fields: new Set() };
    group.count++;
    Object.keys(entry.changes || {}).forEach(field => group.fields.add(field));
    bySymbol.set(symbol, group);
  }
  return [...bySymbol]
    .map(([symbol, { count, fields }]) => `${symbol} (${count}${fields.size ? `: ${[...fields].join(', ')}` : ''})`)
    .join(', ');
}

const MAX_SYMBOLS_PER_ERROR = 25;

/**
 * Group schema errors by field and message, listing each offending symbol once
 * with its chain count, instead of one error per token entry
 */
function formatValidationErrors(errors, tokenlist) {
  const groups = new Map();
  for (const error of errors) {
    const value = error.instancePath.split('/').slice(1).reduce((obj, key) => obj?.[key], tokenlist);
    const [, index, field] = error.instancePath.match(/^\/tokens\/(\d+)\/?(.*)$/) || [];
    const token = index === undefined ? null : tokenlist.tokens[index];
    const where = token ? field || 'token' : error.instancePath || '/';
    const size = !token && Array.isArray(value) ? ` (has ${value.length})` : '';
    const key = `${where}: ${error.message}${size}`;

    const group = groups.get(key) || { count: 0, bySymbol: new Map() };
    group.count++;
    groups.set(key, group);
    if (!token) continue;
    const entry = group.bySymbol.get(token.symbol) || { chains: 0, value };
    entry.chains++;
    group.bySymbol.set(token.symbol, entry);
  }

  const lines = [`Validation failed with ${errors.length} error(s):`];
  for (const [key, { count, bySymbol }] of groups) {
    lines.push(`  ${key} - ${count} error(s)`);
    for (const [symbol, { chains, value }] of [...bySymbol].slice(0, MAX_SYMBOLS_PER_ERROR)) {
      const shown = typeof value === 'string' ? `: "${value}" (${value.length} chars)` : '';
      lines.push(`    ${symbol} on ${chains} chain(s)${shown}`);
    }
    if (bySymbol.size > MAX_SYMBOLS_PER_ERROR) {
      lines.push(`    ...and ${bySymbol.size - MAX_SYMBOLS_PER_ERROR} more symbol(s)`);
    }
  }
  return lines.join('\n');
}

/**
 * Update token list with new tokens
 * @param {Array} newTokens - Array of token objects with at minimum: chainId, address, name, symbol, decimals
 *                            logoURI and tags will be auto-generated if not provided
 */
async function updateTokenList(newTokens) {
  // Read current tokenlist
  const tokenlist = JSON.parse(fs.readFileSync(TOKENLIST_PATH, 'utf8'));
  const oldTokens = tokenlist.tokens;

  // Process new tokens - add logoURI and tags if not present
  const processedTokens = newTokens.map(token => ({
    chainId: token.chainId,
    address: token.address,
    name: shortenName(token.name),
    symbol: token.symbol,
    decimals: token.decimals,
    logoURI: `https://xstocks-metadata.backed.fi/logos/tokens/${token.symbol}.png`,
    tags:['xStocks']
  }));

  // Calculate version bump and get summary
  const oldVersion = tokenlist.version;
  const { newVersion, summary } = calculateVersionBump(oldTokens, processedTokens, oldVersion);

  // Update tokenlist
  tokenlist.tokens = processedTokens;
  tokenlist.version = newVersion;
  tokenlist.timestamp = new Date().toISOString();

  // Log summary (by symbol; per-network detail goes to CHANGELOG.md) before
  // validating, so it is shown even when validation fails
  const versionStr = v => `${v.major}.${v.minor}.${v.patch}`;

  console.log('=== Update Summary ===');
  console.log(`Version:  ${versionStr(oldVersion)} → ${versionStr(newVersion)} (${summary.versionBumpReason})`);
  console.log(`Tokens:   ${oldTokens.length} → ${processedTokens.length}`);
  console.log('');
  console.log(`Added:    ${summary.added}${summary.added ? `  ${summarizeBySymbol(summary.addedTokens)}` : ''}`);
  console.log(`Removed:  ${summary.removed}${summary.removed ? `  ${summarizeBySymbol(summary.removedTokens)}` : ''}`);
  console.log(`Modified: ${summary.modified}${summary.modified ? `  ${summarizeBySymbol(summary.modifiedTokens)}` : ''}`);

  // Validate using Uniswap token-lists schema
  const validationErrors = isValidTokenList(tokenlist);

  if (validationErrors !== true) {
    console.error(`\n${formatValidationErrors(validationErrors, tokenlist)}`);
    console.error('\nNothing was written.');
    process.exit(1);
  }

  console.log('\nValidation passed!');

  // Write updated tokenlist
  fs.writeFileSync(TOKENLIST_PATH, JSON.stringify(tokenlist, null, 4) + '\n');
  console.log('\nUpdated tokenlist.json');

  // Append to changelog if there were changes
  if (summary.added > 0 || summary.removed > 0 || summary.modified > 0) {
    appendChangelog(newVersion, summary, tokenlist.timestamp);
  }

  // Check logo URIs and update README with stats + broken logos in one pass
  const brokenLogos = await checkLogoURIs(processedTokens);
  updateReadme(processedTokens, brokenLogos);

  return tokenlist;
}

/**
 * Replace entire token array from a JSON file or inline data
 * Usage: node update-tokenlist.js <path-to-new-tokens.json>
 *        OR import and call replaceTokens(newTokensArray)
 */
async function replaceTokens(newTokens) {
  return updateTokenList(newTokens);
}

// CLI usage
if (require.main === module) {
  (async () => {
    try {
      const args = process.argv.slice(2);
      const isFileArg = args.length === 1 && args[0].endsWith('.json');

      if (!isFileArg) {
        // Default: fetch live from the xStocks API, plus any tickers passed as
        // args, read from preseed.json (Private pre-IPO assets).
        // Preseed is loaded first so a missing ticker fails fast, but appended
        // last so public API data wins the dedupe.
        const preseeded = args.length > 0 ? loadPreseededAssets(args) : [];
        const assets = await fetchAllAssets();
        console.log(`Fetched ${assets.length} assets from API`);
        if (preseeded.length > 0) {
          console.log(`Loaded ${args.join(', ')} from preseed.json`);
        }
        assets.push(...preseeded);
        const allTokens = transformAssetsToTokens(assets);
        console.log(`Transformed to ${allTokens.length} token entries`);
        const existingTokens = JSON.parse(fs.readFileSync(TOKENLIST_PATH, 'utf8')).tokens;
        const { tokens, deferred } = capTokens(allTokens, existingTokens, args);
        if (deferred.length > 0) {
          console.log(`Deferred ${deferred.length} new entries to stay within the ${MAX_TOKENS} token cap: ${summarizeBySymbol(deferred.map(formatTokenShort))}`);
        }
        console.log('');
        await replaceTokens(tokens);
      } else {
        // Accept a local JSON file as an override (API-format or flat token list)
        const newTokensPath = args[0];
        const data = JSON.parse(fs.readFileSync(newTokensPath, 'utf8'));
        const newTokens = Array.isArray(data) && data[0] && data[0].deployments
          ? transformAssetsToTokens(data)
          : data;
        await replaceTokens(newTokens);
      }
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  })();
}

module.exports = { updateTokenList, replaceTokens, calculateVersionBump, fetchAllAssets, loadPreseededAssets, transformAssetsToTokens, CHAIN_IDS };
