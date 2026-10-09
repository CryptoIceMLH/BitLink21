import pytest


@pytest.fixture(autouse=True)
def _logs_in_tmp(tmp_path, monkeypatch):
    """Keep diagnostics log files out of the real data folder during tests."""
    from bitlink21 import diagnostics

    monkeypatch.setattr(diagnostics, "LOG_DIR", str(tmp_path / "logs"))
