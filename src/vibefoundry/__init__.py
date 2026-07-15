"""
VibeFoundry IDE - A local IDE for data science workflows
"""

from importlib.metadata import PackageNotFoundError, version as _pkg_version

# Read from the installed distribution rather than hardcoding: publish.sh bumps
# pyproject.toml only, so a literal here silently drifts — it sat at 0.2.11 while
# PyPI was on 0.2.29, so `vibefoundry --version` lied for ~19 releases.
try:
    __version__ = _pkg_version("vibefoundry")
except PackageNotFoundError:  # source checkout, not pip-installed
    __version__ = "0.0.0+dev"

__all__ = ["main", "__version__"]

from vibefoundry.cli import main
