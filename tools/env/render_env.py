"""
render_env.py - Per-worktree session and port allocation
========================================================

WHAT THIS FILE DOES:
Renders `env.template` to `.env`, filling in a SESSION name derived from the
repository and branch, plus a deterministic port per named key. Two worktrees
of the same repo therefore get different ports and different container names,
and can run at the same time.

ENTRY POINT:
- `python3 -m tools.env.render_env [--force]`

TEMPLATE DIRECTIVES (only two, on purpose):
    SESSION={{ session }}
    BACKEND_PORT={{ port "backend" }}
A key always renders to the same port within one run, so the same key can be
referenced from several lines and cross-referenced in URLs.

WHY HASHED PORTS:
The port is a pure function of (session, key), so nothing has to be recorded
between runs and two worktrees never negotiate. A port already bound on the
machine is re-rolled deterministically, so a collision resolves the same way
on the next run as long as the conflicting process is still there.

RELATED FILES:
- env.template (project-owned), Taskfile.yml (`task env:render`)
- .env is gitignored; .env.overrides holds real secrets and is never rendered
"""

from __future__ import annotations

import argparse
import hashlib
import re
import socket
import subprocess
import sys
from pathlib import Path

TEMPLATE_FILENAME = "env.template"
OUTPUT_FILENAME = ".env"

PORT_MIN = 20000
PORT_MAX = 60000
MAX_REROLLS = 64

SESSION_DIRECTIVE = re.compile(r"\{\{\s*session\s*\}\}")
PORT_DIRECTIVE = re.compile(r"""\{\{\s*port\s+["'](?P<key>[^"']+)["']\s*\}\}""")
SESSION_LINE = re.compile(r"^SESSION=(?P<value>.*)$", re.MULTILINE)

_UNSAFE = re.compile(r"[^a-z0-9]+")


class PortAllocator:
    """Deterministic port-per-key allocator, seeded by the session name."""

    def __init__(self, session: str, probe_bound: bool = True) -> None:
        self.session = session
        self.probe_bound = probe_bound
        self.assigned: dict[str, int] = {}

    def allocate(self, key: str) -> int:
        """Return this session's port for `key`, stable within the run."""
        if key in self.assigned:
            return self.assigned[key]
        taken = set(self.assigned.values())
        for attempt in range(MAX_REROLLS):
            port = self._candidate(key, attempt)
            if port not in taken and self._is_free(port):
                self.assigned[key] = port
                return port
        raise RuntimeError(
            f"no free port for key {key!r} after {MAX_REROLLS} attempts in "
            f"[{PORT_MIN}, {PORT_MAX}). Free some ports and re-run."
        )

    def _candidate(self, key: str, attempt: int) -> int:
        seed = f"{self.session}\x00{key}\x00{attempt}".encode()
        digest = hashlib.sha256(seed).digest()
        return PORT_MIN + int.from_bytes(digest[:4], "big") % (PORT_MAX - PORT_MIN)

    def _is_free(self, port: int) -> bool:
        if not self.probe_bound:
            return True
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                return False
        return True


def git_output(root: Path, *args: str) -> str:
    proc = subprocess.run(
        ["git", *args], cwd=root, capture_output=True, text=True, check=False,
    )
    return proc.stdout.strip() if proc.returncode == 0 else ""


def repository_name(root: Path) -> str:
    """Name of the main clone, so every worktree agrees on the prefix."""
    common = git_output(root, "rev-parse", "--path-format=absolute", "--git-common-dir")
    if common:
        return Path(common).parent.name
    return root.name


def current_branch(root: Path) -> str:
    """`git branch --show-current` first: it answers before the first commit."""
    return (
        git_output(root, "branch", "--show-current")
        or git_output(root, "rev-parse", "--abbrev-ref", "HEAD")
        or "detached"
    )


def session_name(root: Path) -> str:
    """`<repo>-<branch>`, flattened to a safe container/volume prefix.

    Example: forge + feat/login -> "forge-feat-login"
    """
    name = f"{slugify(repository_name(root))}-{slugify(current_branch(root))}"
    return name.strip("-")


def slugify(value: str) -> str:
    return _UNSAFE.sub("-", value.lower()).strip("-")


def render(template: str, session: str, allocator: PortAllocator) -> str:
    """Substitute both directives in the template text."""
    text = SESSION_DIRECTIVE.sub(session, template)
    return PORT_DIRECTIVE.sub(
        lambda m: str(allocator.allocate(m.group("key"))), text,
    )


def previous_session(output_path: Path) -> str | None:
    """SESSION recorded in an existing .env, if any."""
    if not output_path.exists():
        return None
    match = SESSION_LINE.search(output_path.read_text())
    return match.group("value").strip() if match else None


def stale_session_warning(previous: str | None, session: str) -> str:
    """Renaming a branch re-seeds every port and orphans running state.

    Containers and volumes are named after the OLD session, so they survive
    the re-render invisible to `task dev:stop`. Say so before it happens.
    """
    if previous is None or previous == session:
        return ""
    return (
        f"WARNING  session changed: {previous} -> {session}\n"
        f"         Containers, volumes and ports from {previous} are still\n"
        f"         running and are no longer referenced by .env.\n"
        f"         Run `task dev:stop-clean` BEFORE re-rendering, or clean up\n"
        f"         {previous}-* by hand.\n\n"
    )


def render_env_file(root: Path, force: bool) -> tuple[str, int]:
    """Render the template to .env. Returns (text, exit_code)."""
    template_path = root / TEMPLATE_FILENAME
    output_path = root / OUTPUT_FILENAME
    if not template_path.exists():
        return (
            f"FAIL  {TEMPLATE_FILENAME} not found at {template_path}.\n\nExit 1.\n",
            1,
        )
    session = session_name(root)
    warning = stale_session_warning(previous_session(output_path), session)
    if warning and not force:
        return warning + "Re-run with --force to render anyway.\n\nExit 1.\n", 1
    allocator = PortAllocator(session)
    output_path.write_text(render(template_path.read_text(), session, allocator))
    return warning + _summary(session, allocator), 0


def _summary(session: str, allocator: PortAllocator) -> str:
    lines = [f"PASS  Rendered {OUTPUT_FILENAME} for session {session}.", ""]
    lines += [f"  {key} = {port}" for key, port in sorted(allocator.assigned.items())]
    lines += ["", "Exit 0."]
    return "\n".join(lines) + "\n"


def main(argv: list[str], cwd: Path | None = None) -> int:
    """CLI entry point. `cwd` is injectable so tests can run in a tmpdir."""
    parser = argparse.ArgumentParser(prog="render_env")
    parser.add_argument(
        "--force", action="store_true", help="Render even if the session changed.",
    )
    args = parser.parse_args(argv)
    text, exit_code = render_env_file(cwd or Path.cwd(), args.force)
    print(text, end="")
    return exit_code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
