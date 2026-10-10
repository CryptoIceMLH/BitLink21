"""Minimal LND REST client: node info, decode / create / look up invoices,
and pay an invoice.

Connection details come from an lndconnect link (what Umbrel's Lightning
app shows under "Connect wallet"):

    lndconnect://host:port?cert=<base64url DER>&macaroon=<base64url>

or from a REST URL plus the macaroon in hex. LND authenticates every call
with the macaroon (Grpc-Metadata-macaroon header) and serves a self-signed
TLS certificate: when the certificate is known it is pinned (only that
certificate is accepted); without it the connection is encrypted but not
verified, which is only sensible on your own LAN.
"""

import base64
import binascii
import json
import math
import ssl
import textwrap
from typing import Any, Dict, Optional
from urllib.parse import parse_qs, urlparse

import aiohttp


class LndError(RuntimeError):
    pass


def _b64url_decode(text: str) -> bytes:
    text = text.strip()
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _der_to_pem(der: bytes) -> str:
    body = "\n".join(textwrap.wrap(base64.b64encode(der).decode("ascii"), 64))
    return f"-----BEGIN CERTIFICATE-----\n{body}\n-----END CERTIFICATE-----\n"


def parse_lndconnect(uri: str) -> Dict[str, str]:
    """lndconnect link -> {rest_url, macaroon_hex, cert_pem}."""
    uri = (uri or "").strip()
    if not uri.lower().startswith("lndconnect://"):
        raise ValueError("Not an lndconnect link (it starts with lndconnect://)")
    parsed = urlparse(uri)
    if not parsed.hostname:
        raise ValueError("The lndconnect link has no host")
    query = parse_qs(parsed.query)
    mac = (query.get("macaroon") or [""])[0]
    if not mac:
        raise ValueError("The lndconnect link has no macaroon")
    try:
        macaroon_hex = _b64url_decode(mac).hex()
    except (binascii.Error, ValueError):
        raise ValueError("The macaroon in the lndconnect link is not valid base64")
    cert_pem = ""
    cert = (query.get("cert") or [""])[0]
    if cert:
        try:
            cert_pem = _der_to_pem(_b64url_decode(cert))
        except (binascii.Error, ValueError):
            raise ValueError("The certificate in the lndconnect link is not valid base64")
    host = parsed.hostname
    if ":" in host:  # IPv6
        host = f"[{host}]"
    return {"rest_url": f"https://{host}:{parsed.port or 8080}", "macaroon_hex": macaroon_hex, "cert_pem": cert_pem}


def default_fee_limit_sat(amount_sat: int) -> int:
    """Routing fee cap: 1 % of the amount, at least 10 sats."""
    return max(10, math.ceil(amount_sat * 0.01))


class LndClient:
    def __init__(self, rest_url: str, macaroon_hex: str, cert_pem: str = "", timeout: float = 15.0):
        if not rest_url:
            raise LndError("LND is not set up")
        if not macaroon_hex:
            raise LndError("No LND macaroon set")
        try:
            bytes.fromhex(macaroon_hex)
        except ValueError:
            raise LndError("The macaroon must be hex")
        self.rest_url = rest_url.rstrip("/")
        self.headers = {"Grpc-Metadata-macaroon": macaroon_hex}
        self.timeout = timeout
        if not self.rest_url.startswith("https://"):
            self._ssl: Any = None  # plain http (tests, or a local proxy)
        elif cert_pem:
            ctx = ssl.create_default_context(cadata=cert_pem)
            ctx.check_hostname = False  # pinned: only this exact certificate is accepted
            self._ssl = ctx
        else:
            self._ssl = False

    @classmethod
    def from_settings(cls, ln: Dict[str, Any]) -> "LndClient":
        return cls(ln.get("lnd_rest_url") or "", ln.get("macaroon_hex") or "", ln.get("cert_pem") or "")

    async def _call(self, method: str, path: str, body: Optional[dict] = None, timeout: Optional[float] = None) -> Any:
        try:
            async with aiohttp.ClientSession(headers=self.headers) as session:
                async with session.request(method, self.rest_url + path, json=body, ssl=self._ssl,
                                           timeout=aiohttp.ClientTimeout(total=timeout or self.timeout)) as resp:
                    text = await resp.text()
                    if resp.status != 200:
                        try:
                            msg = json.loads(text).get("message") or text
                        except ValueError:
                            msg = text
                        raise LndError(f"LND {resp.status}: {msg.strip()[:200]}")
                    return text
        except aiohttp.ClientError as e:
            raise LndError(f"Cannot reach LND: {e}")
        except TimeoutError:
            raise LndError("LND did not answer in time")

    async def _json(self, method: str, path: str, body: Optional[dict] = None) -> Dict[str, Any]:
        return json.loads(await self._call(method, path, body))

    async def get_info(self) -> Dict[str, Any]:
        info = await self._json("GET", "/v1/getinfo")
        bal = await self._json("GET", "/v1/balance/channels")
        local = bal.get("local_balance", {}).get("sat")
        if local is None:
            local = bal.get("balance", 0)
        chains = info.get("chains") or [{}]
        return {
            "alias": info.get("alias"),
            "pubkey": info.get("identity_pubkey"),
            "network": chains[0].get("network"),
            "synced": bool(info.get("synced_to_chain")),
            "active_channels": int(info.get("num_active_channels") or 0),
            "spendable_sat": int(local or 0),
        }

    async def decode(self, payment_request: str) -> Dict[str, Any]:
        d = await self._json("GET", f"/v1/payreq/{payment_request.strip()}")
        return {
            "amount_sat": int(d.get("num_satoshis") or 0),
            "description": d.get("description") or "",
            "destination": d.get("destination"),
            "payment_hash": d.get("payment_hash"),
            "created_at": int(d.get("timestamp") or 0),
            "expiry_s": int(d.get("expiry") or 3600),
        }

    async def add_invoice(self, amount_sat: int, memo: str, expiry_s: int = 3600) -> Dict[str, Any]:
        d = await self._json("POST", "/v1/invoices", {"value": str(int(amount_sat)), "memo": memo, "expiry": str(expiry_s)})
        return {
            "payment_request": d["payment_request"],
            "payment_hash": base64.b64decode(d["r_hash"]).hex(),
        }

    async def invoice_state(self, payment_hash_hex: str) -> Dict[str, Any]:
        d = await self._json("GET", f"/v1/invoice/{payment_hash_hex}")
        return {"state": d.get("state"), "amount_paid_sat": int(d.get("amt_paid_sat") or 0),
                "settled_at": int(d.get("settle_date") or 0)}

    async def pay(self, payment_request: str, fee_limit_sat: int, amount_sat: Optional[int] = None,
                  timeout_s: int = 60) -> Dict[str, Any]:
        body: Dict[str, Any] = {"payment_request": payment_request.strip(), "timeout_seconds": timeout_s,
                                "fee_limit_sat": str(int(fee_limit_sat)), "no_inflight_updates": True}
        if amount_sat:
            body["amt"] = str(int(amount_sat))
        # Streams one JSON object per payment update; the last one is final
        text = await self._call("POST", "/v2/router/send", body, timeout=timeout_s + 15)
        final: Dict[str, Any] = {}
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            if "error" in obj:
                raise LndError(obj["error"].get("message") or str(obj["error"]))
            final = obj.get("result", obj)
        status = final.get("status")
        if status == "SUCCEEDED":
            return {"paid": True, "preimage": final.get("payment_preimage"),
                    "fee_sat": int(final.get("fee_sat") or 0), "amount_sat": int(final.get("value_sat") or 0)}
        reason = (final.get("failure_reason") or "unknown").replace("FAILURE_REASON_", "").replace("_", " ").lower()
        return {"paid": False, "reason": reason, "status": status}
