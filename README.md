# Cowswap xStocks Token List

Token list for xStocks tokenized assets, following the [Uniswap Token Lists](https://github.com/Uniswap/token-lists) specification.

> **Note:** To update the token list, run `npm run update`. This fetches live data from the xStocks API v2 `/assets` endpoint (`https://api.xstocks.fi/api/v2/public/assets`). A local file path can also be passed as an argument for offline overrides.

## Token Statistics

| Network | Tokens |
|---------|--------|
| Ethereum | 129 |
| XLayer | 129 |
| BinanceSmartChain | 100 |
| Ink | 99 |
| Mantle | 93 |
| Arbitrum | 85 |
| HyperEVM | 85 |
|---------|--------|
| **Total** | **720** |

### Network Coverage Gaps

Unique symbols: 130

- **Arbitrum** missing 45: ENHAx, EWYx, DAXx, SATAx, SOXXx, EWUx, EWGx, EWQx, BITXx, VOOx, NLRx, GDXx, FEZx, JAAAx, JPSTx, FLQMx, USPXx, FSMLx, FLBLx, IQMx, YLDEx, FAAAx, SOXLx, VIDAx, RCATx, ONDSx, IRENx, HIMSx, NETx, LNGx, MOOx, XOPx, VGKx, ITAx, VUGx, SMHx, URAx, XLEx, VCXx, SNDKx, CEGx, SMCIx, DELLx, USARx, UUUUx
- **HyperEVM** missing 45: ENHAx, EWYx, DAXx, SATAx, SOXXx, EWUx, EWGx, EWQx, BITXx, VOOx, NLRx, GDXx, FEZx, JAAAx, JPSTx, FLQMx, USPXx, FSMLx, FLBLx, IQMx, YLDEx, FAAAx, SOXLx, VIDAx, RCATx, ONDSx, IRENx, HIMSx, NETx, LNGx, MOOx, XOPx, VGKx, ITAx, VUGx, SMHx, URAx, XLEx, VCXx, SNDKx, CEGx, SMCIx, DELLx, USARx, UUUUx
- **Mantle** missing 37: ENHAx, EWYx, DAXx, SATAx, SOXXx, EWUx, EWGx, EWQx, BITXx, VOOx, NLRx, GDXx, FEZx, JAAAx, JPSTx, FLQMx, USPXx, FSMLx, FLBLx, IQMx, YLDEx, FAAAx, SOXLx, VIDAx, RCATx, ONDSx, IRENx, HIMSx, NETx, LNGx, ITAx, PPLTx, PALLx, COPXx, BTGOx, SLVx, NFLXx
- **Ink** missing 31: ENHAx, EWYx, DAXx, SATAx, SOXXx, EWUx, EWGx, EWQx, BITXx, VOOx, NLRx, GDXx, FEZx, JAAAx, JPSTx, FLQMx, USPXx, FSMLx, FLBLx, IQMx, YLDEx, FAAAx, SOXLx, VIDAx, RCATx, ONDSx, IRENx, HIMSx, NETx, LNGx, SLVx
- **BinanceSmartChain** missing 30: ENHAx, EWYx, DAXx, SATAx, SOXXx, EWUx, EWGx, EWQx, BITXx, VOOx, NLRx, GDXx, FEZx, JAAAx, JPSTx, FLQMx, USPXx, FSMLx, FLBLx, IQMx, YLDEx, FAAAx, SOXLx, VIDAx, RCATx, ONDSx, IRENx, HIMSx, NETx, LNGx
- **Ethereum** missing 1: MDLNx
- **XLayer** missing 1: MDLNx


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

