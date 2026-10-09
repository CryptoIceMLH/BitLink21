"""BitLink21 diagnostics: log files on disk, verbose mode and a downloadable
bundle (logs + system/version info + redacted settings + radio status).

Logs live next to the database (data/logs/), so they survive restarts and
updates: server.log (main process) and radio.log (PlutoSDR worker process),
each rotated at 5 MB with 3 old files kept.
"""

import io
import json
import logging
import os
import platform
import shutil
import time
import zipfile
from logging.handlers import RotatingFileHandler
from typing import Any, Dict, Optional

DATA_DIR = os.path.dirname(os.environ.get("BITLINK21_DB_PATH", "/app/backend/data/bitlink21.db"))
LOG_DIR = os.path.join(DATA_DIR, "logs")
MAX_BYTES = 5 * 1024 * 1024
BACKUPS = 3
# Loggers whose level follows the verbose switch
VERBOSE_LOGGERS = ("bitlink21", "plutosdr-worker", "process-lifecycle")


def install_file_logging(name: str) -> Optional[str]:
    """Add a rotating log file for this process (replacing one inherited from
    a parent process). Returns the file path, or None if the folder is not
    writable."""
    root = logging.getLogger()
    for h in list(root.handlers):
        if getattr(h, "_bitlink21_file", False):
            root.removeHandler(h)
            h.close()
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        path = os.path.join(LOG_DIR, f"{name}.log")
        handler = RotatingFileHandler(path, maxBytes=MAX_BYTES, backupCount=BACKUPS, encoding="utf-8")
    except OSError:
        return None
    handler._bitlink21_file = True
    handler.setFormatter(logging.Formatter("[%(asctime)s] %(name)s %(levelname)s %(message)s"))
    handler.setLevel(logging.DEBUG)
    root.addHandler(handler)
    return path


def set_verbose(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    for name in VERBOSE_LOGGERS:
        logging.getLogger(name).setLevel(level)


def _read(path: str) -> str:
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


def system_info() -> Dict[str, Any]:
    info: Dict[str, Any] = {
        "time_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "platform": platform.platform(),
        "python": platform.python_version(),
        "machine": platform.machine(),
    }
    cpuinfo = _read("/proc/cpuinfo")
    for line in cpuinfo.splitlines():
        if line.startswith("model name"):
            info["cpu_model"] = line.split(":", 1)[1].strip()
            break
    flags = set()
    for line in cpuinfo.splitlines():
        if line.startswith("flags"):
            flags = set(line.split(":", 1)[1].split())
            break
    info["cpu_count"] = os.cpu_count()
    info["cpu_simd"] = {f: f in flags for f in ("sse4_2", "avx", "avx2", "fma", "avx512f")}
    mem = {}
    for line in _read("/proc/meminfo").splitlines():
        key = line.split(":", 1)[0]
        if key in ("MemTotal", "MemAvailable"):
            mem[key] = line.split(":", 1)[1].strip()
    info["memory"] = mem
    try:
        du = shutil.disk_usage(DATA_DIR)
        info["data_disk_free_gb"] = round(du.free / 1e9, 1)
    except OSError:
        pass
    try:
        import numpy

        info["numpy"] = numpy.__version__
    except Exception:
        pass
    try:
        from gnuradio import gr

        info["gnuradio"] = gr.version()
    except Exception as e:
        info["gnuradio"] = f"unavailable ({e.__class__.__name__})"
    info["dvbs2_rx"] = shutil.which("dvbs2-rx")
    return info


def build_bundle(state: Dict[str, Any], messages: list, files: list) -> bytes:
    """Zip with logs, version/system info, redacted settings and radio state."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        if os.path.isdir(LOG_DIR):
            for name in sorted(os.listdir(LOG_DIR)):
                path = os.path.join(LOG_DIR, name)
                if os.path.isfile(path):
                    z.write(path, f"logs/{name}")
        version = _read(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                     "server", "version.json"))
        z.writestr("version.json", version or "{}")
        z.writestr("system.json", json.dumps(system_info(), indent=2))
        z.writestr("state.json", json.dumps(state, indent=2, default=str))
        z.writestr("messages.json", json.dumps(messages, indent=2, default=str))
        z.writestr("files.json", json.dumps(files, indent=2, default=str))
    return buf.getvalue()
