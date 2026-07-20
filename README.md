# Cowswap xStocks Token List

Token list for xStocks tokenized assets, following the [Uniswap Token Lists](https://github.com/Uniswap/token-lists) specification.

> **Note:** To update the token list, run `npm run update`. This fetches live data from the xStocks API v2 `/assets` endpoint (`https://api.xstocks.fi/api/v2/public/assets`). A local file path can also be passed as an argument for offline overrides.

## Token Statistics

| Network | Tokens |
|---------|--------|
| Ethereum | 179 |
| Optimism | 179 |
| BinanceSmartChain | 179 |
| XLayer | 179 |
| Ink | 179 |
| Mantle | 171 |
| HyperEVM | 150 |
| Arbitrum | 150 |
|---------|--------|
| **Total** | **1366** |

### Network Coverage Gaps

Unique symbols: 179

- **HyperEVM** missing 29: UUUUx, USARx, ANETx, LRCXx, AMATx, VRTx, DELLx, SMCIx, CEGx, GEVx, KLACx, ETNx, TERx, PWRx, APLDx, SMRx, LITEx, SNDKx, VCXx, XLEx, URAx, SMHx, VUGx, SGOVx, VXUSx, ITAx, VGKx, XOPx, MOOx
- **Arbitrum** missing 29: UUUUx, USARx, ANETx, LRCXx, AMATx, VRTx, DELLx, SMCIx, CEGx, GEVx, KLACx, ETNx, TERx, PWRx, APLDx, SMRx, LITEx, SNDKx, VCXx, XLEx, URAx, SMHx, VUGx, SGOVx, VXUSx, ITAx, VGKx, XOPx, MOOx
- **Mantle** missing 8: SLVx, BTGOx, KRAQx, SLMTx, COPXx, PALLx, PPLTx, ITAx


## Usage

Add the token list URL to your DEX or wallet that supports Uniswap Token Lists.

## Updating the Token List

Use the `update-tokenlist.js` script to update tokens:

```bash
# Using npm script (reads from public_atomic_tokenlist.json)
npm run update

# Or explicitly with node
node update-tokenlist.js <path-to-new-tokens.json>
```

The script will:

- Validate the token list against the Uniswap schema
- Auto-generate `logoURI` and `tags` if not provided
- Calculate semantic version bump based on changes
- Update `CHANGELOG.md` with a summary of changes
- Update token statistics in `README.md`

### Semantic Versioning

Following the [Token Lists specification](https://github.com/Uniswap/token-lists#semantic-versioning):

- **Major**: Tokens removed
- **Minor**: Tokens added
- **Patch**: Token details modified (name, symbol, logo, decimals)

## Supported Networks

| Network | Chain ID |
|---------|----------|
| Ethereum | 1 |
| Polygon | 137 |
| BinanceSmartChain | 56 |
| Arbitrum | 42161 |
| Avalanche | 43114 |
| Base | 8453 |
| Fantom | 250 |
| Gnosis | 100 |
| Mantle | 5000 |
| Ink | 57073 |
| Lisk | 1135 |
| Sonic | 146 |
| Etherlink | 42793 |
| HyperEVM | 999 |
| Tron | 728126428 |

