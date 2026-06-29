"""Static ticker universes for the universe scanner. Membership is approximate."""
from __future__ import annotations

DJIA: list[str] = [
    "AAPL", "AMGN", "AMZN", "AXP", "BA", "CAT", "CRM", "CSCO", "CVX", "DIS",
    "DOW", "GS", "HD", "HON", "IBM", "JNJ", "JPM", "KO", "MCD", "MMM",
    "MRK", "MSFT", "NKE", "NVDA", "PG", "SHW", "TRV", "UNH", "V", "WMT",
]

SP100: list[str] = [
    # Technology
    "AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "ADBE", "CSCO", "CRM", "INTU", "QCOM",
    "TXN", "ACN", "IBM", "AMD", "INTC", "MU", "AMAT",
    # Consumer Discretionary
    "AMZN", "TSLA", "HD", "MCD", "NKE", "LOW", "SBUX", "TGT", "TJX", "ROST",
    "BKNG",
    # Consumer Staples
    "WMT", "COST", "PG", "KO", "PEP", "PM", "MDLZ", "KMB", "CL",
    # Healthcare
    "JNJ", "UNH", "LLY", "PFE", "ABBV", "MRK", "TMO", "ABT", "AMGN", "BMY",
    "GILD", "REGN", "VRTX", "ISRG", "SYK", "MDT", "CVS", "CI", "HUM", "ELV",
    # Financials
    "JPM", "BAC", "WFC", "GS", "MS", "BLK", "AXP", "C", "SCHW", "V", "MA",
    "COF", "BK", "SPGI", "CME",
    # Energy
    "XOM", "CVX", "COP", "EOG", "SLB",
    # Industrials
    "HON", "GE", "CAT", "BA", "RTX", "LMT", "NOC", "MMM", "ETN", "ITW",
    "UPS", "FDX", "ADP",
    # Communication
    "GOOGL", "META", "DIS", "CMCSA", "T", "VZ", "TMUS", "NFLX",
    # Materials / Utilities / RE
    "NEE", "PLD", "LIN", "APD", "SHW", "NEM",
]

NASDAQ100: list[str] = [
    "AAPL", "MSFT", "NVDA", "AMZN", "META", "TSLA", "GOOGL", "GOOG", "AVGO", "COST",
    "NFLX", "AMD", "PEP", "ADBE", "QCOM", "CSCO", "TXN", "INTU", "AMGN", "HON",
    "CMCSA", "AMAT", "SBUX", "MU", "LRCX", "MDLZ", "BKNG", "MELI", "GILD", "KLAC",
    "REGN", "PYPL", "SNPS", "CDNS", "ADI", "PANW", "ORLY", "MNST", "CHTR", "FTNT",
    "NXPI", "MRVL", "CRWD", "ODFL", "CTAS", "PAYX", "ADP", "ROST", "FAST", "DLTR",
    "EXC", "XEL", "PCAR", "VRSK", "DXCM", "IDXX", "BIIB", "TTWO", "ON", "GEHC",
    "APP", "KDP", "TEAM", "ALGN", "ABNB", "CDW", "ILMN", "CPRT", "EA", "ANSS",
    "WDAY", "EBAY", "LULU", "CEG", "FANG", "MRNA", "MCHP", "VRTX", "ISRG", "ROP",
    "INTC", "MAR", "TTD", "CSGP", "FSLR", "ENPH", "ZS", "DDOG", "MDB", "NET",
    "ZM", "OKTA", "SMCI", "ARM", "CCEP", "TCOM", "GRAB", "PDD",
]

SP500: list[str] = [
    # Technology
    "AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "ADBE", "CSCO", "CRM", "INTU", "QCOM",
    "TXN", "ACN", "IBM", "AMD", "INTC", "MU", "AMAT", "LRCX", "KLAC", "ADI",
    "MCHP", "CDNS", "SNPS", "HPQ", "HPE", "DELL", "CDW", "CTSH", "GPN", "FIS",
    "FISV", "GDDY", "IT", "EPAM", "NXPI", "TER", "KEYS", "VRSN", "MPWR", "FTNT",
    "PANW", "ZS", "CRWD", "OKTA", "DDOG", "MDB", "NET", "TEAM", "WDAY", "NOW",
    "ANSS", "ENPH", "FSLR", "ROP", "SSNC", "PYPL", "WU",
    # Consumer Discretionary
    "AMZN", "TSLA", "HD", "MCD", "NKE", "LOW", "SBUX", "TGT", "TJX", "ROST",
    "BKNG", "MAR", "HLT", "CMG", "DHI", "LEN", "NVR", "PHM", "TOL", "EBAY",
    "ETSY", "MELI", "ABNB", "ULTA", "LULU", "AZO", "ORLY", "GPC", "AN", "KMX",
    "LAD", "LVS", "WYNN", "MGM", "NCLH", "CCL", "RCL", "VFC", "PVH", "RL",
    "TPR", "F", "GM", "APTV", "BWA", "GRMN", "POOL", "DECK",
    # Consumer Staples
    "WMT", "COST", "PG", "KO", "PEP", "PM", "MO", "MDLZ", "KHC", "KMB",
    "CL", "GIS", "K", "CPB", "HRL", "SJM", "CAG", "MKC", "CHD", "CLX",
    "MNST", "KDP", "STZ", "TAP", "EL", "PRGO",
    # Healthcare
    "JNJ", "UNH", "LLY", "PFE", "ABBV", "MRK", "TMO", "ABT", "AMGN", "BMY",
    "GILD", "REGN", "VRTX", "BIIB", "ISRG", "SYK", "MDT", "BDX", "BSX", "ZBH",
    "EW", "DXCM", "IDXX", "IQV", "CRL", "HOLX", "ALGN", "GEHC", "MRNA",
    "CAH", "MCK", "ABC", "CVS", "CI", "HUM", "MOH", "ELV", "CNC", "HCA",
    "DGX", "LH", "A", "WAT", "MTD", "ILMN", "BAX", "HSIC", "XRAY", "PODD",
    # Financials
    "JPM", "BAC", "WFC", "GS", "MS", "BLK", "SCHW", "AXP", "C", "USB",
    "TFC", "PNC", "COF", "MTB", "RF", "CFG", "HBAN", "KEY", "FITB", "STT",
    "BK", "NTRS", "V", "MA", "FNF", "PFG", "PRU", "MET", "AFL", "ALL",
    "TRV", "CB", "AIG", "MMC", "AON", "AJG", "CINF", "ICE", "CME", "SPGI",
    "MCO", "MSCI", "NDAQ",
    # Energy
    "XOM", "CVX", "COP", "PSX", "VLO", "MPC", "HES", "EOG", "PXD", "DVN",
    "OXY", "CTRA", "APA", "EQT", "SWN", "HAL", "SLB", "BKR", "MRO", "FANG",
    "TRGP", "OKE", "WMB", "KMI",
    # Industrials
    "HON", "MMM", "GE", "CAT", "BA", "RTX", "LMT", "NOC", "GD", "TDG",
    "CARR", "OTIS", "EMR", "ETN", "PH", "ROK", "AME", "FTV", "XYL", "ITW",
    "DOV", "IR", "ALLE", "SWK", "GWW", "IEX", "GNRC", "CTAS", "PAYX", "ADP",
    "CPRT", "ODFL", "EXPD", "FDX", "UPS", "CHRW", "JBHT", "PWR", "MTZ", "EME",
    "FAST", "MSC", "RSG", "WM", "VRSK", "PCAR",
    # Materials
    "LIN", "APD", "DOW", "DD", "ECL", "PPG", "SHW", "EMN", "FMC", "CE",
    "HUN", "RPM", "IFF", "CTVA", "NEM", "FCX", "NUE", "STLD", "RS", "ATI",
    "ALB",
    # Utilities
    "NEE", "DUK", "SO", "D", "EXC", "AEP", "XEL", "ES", "WEC", "ETR",
    "CNP", "CMS", "DTE", "PPL", "SRE", "NI", "PNW", "ATO", "LNT", "AWK",
    # Real Estate
    "PLD", "AMT", "EQIX", "CCI", "SPG", "VTR", "ARE", "UDR", "CPT", "EQR",
    "ESS", "MAA", "NNN", "O", "WPC", "BRX", "KIM", "REG", "FRT", "AVB",
    "EXR", "PSA", "CUBE",
    # Communication Services
    "GOOGL", "GOOG", "META", "NFLX", "DIS", "CMCSA", "T", "VZ", "TMUS",
    "CHTR", "WBD", "PARA", "FOXA", "TTWO", "EA", "RBLX", "MTCH",
]

# Remove duplicates while preserving order
SP100 = list(dict.fromkeys(SP100))
NASDAQ100 = list(dict.fromkeys(NASDAQ100))
SP500 = list(dict.fromkeys(SP500))

UNIVERSES: dict[str, list[str]] = {
    "djia": DJIA,
    "sp100": SP100,
    "nasdaq100": NASDAQ100,
    "sp500": SP500,
}

UNIVERSE_LABELS: dict[str, str] = {
    "djia": "Dow Jones 30",
    "sp100": "S&P 100",
    "nasdaq100": "NASDAQ 100",
    "sp500": "S&P 500",
}
