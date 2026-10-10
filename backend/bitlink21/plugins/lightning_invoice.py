"""BOLT11 invoice prefix: network and amount, without a node.

Received invoices are decoded in full by the operator's LND (see
bitlink21/lnd.py); this is the fallback when no node is connected and the
quick check before sending."""

import re
from typing import Any, Dict, Optional


_BOLT11_NETWORKS = (
    # longest prefixes first
    ('lnbcrt', 'regtest'),
    ('lntbs', 'signet'),
    ('lnbc', 'mainnet'),
    ('lntb', 'testnet'),
    ('lnsb', 'simnet'),
)
# BOLT11 amount multipliers, as msat per unit
_BOLT11_MULTIPLIER_MSAT = {
    '': 100_000_000_000,  # whole BTC
    'm': 100_000_000,
    'u': 100_000,
    'n': 100,
    'p': 0.1,
}


def parse_bolt11_hrp(invoice: str) -> Optional[Dict[str, Any]]:
    """Parse network and amount from a BOLT11 human-readable part.

    Returns {'network', 'amount_msat'} (amount None for "any amount"
    invoices) or None if the string is not a BOLT11 invoice.
    """
    text = invoice.strip().lower()
    if text.startswith('lightning:'):
        text = text[len('lightning:'):]
    sep = text.rfind('1')
    if sep <= 2 or not text.startswith('ln'):
        return None
    hrp = text[:sep]
    for prefix, network in _BOLT11_NETWORKS:
        if hrp.startswith(prefix):
            rest = hrp[len(prefix):]
            break
    else:
        return None
    match = re.fullmatch(r'(\d*)([munp]?)', rest)
    if not match:
        return None
    digits, mult = match.groups()
    amount_msat = None
    if digits:
        amount_msat = int(int(digits) * _BOLT11_MULTIPLIER_MSAT[mult])
    return {'network': network, 'amount_msat': amount_msat}
