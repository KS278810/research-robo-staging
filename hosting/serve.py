#!/usr/bin/env python3
"""ResearchRobo local server. Serves ONLY git-tracked public files. No dependencies.

usage: python3 hosting/serve.py [PORT] [--host 0.0.0.0] [--no-git] [--quiet]

PORT defaults to 8080. Pass 0 to let the OS pick a free port (the actual port
is printed on the first line: "Serving ResearchRobo ... on http://HOST:PORT/").

Serves only the files that belong to the public ResearchRobo site:
  - if this checkout is a git repository, exactly the files "git ls-files"
    reports (the private dev/ tree and any local scratch files are excluded
    even if they physically sit inside this directory);
  - otherwise (e.g. a plain zip extraction with no .git), falls back to a
    deny-list covering the same private paths.

This script intentionally has zero third-party dependencies (stdlib only) so
it runs unmodified on any machine with Python 3.7+.
"""
import argparse
import os
import posixpath
import shutil
import subprocess
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

if sys.version_info < (3, 7):
    sys.exit("ERROR: Python 3.7+ required")

ROOT = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

# Never serve these even if a stray copy sits inside ROOT (defense in depth;
# the git-tracked-files whitelist already excludes them when .git is present).
# Any dotfile/dotdir segment (.git, .gitignore, ...) is denied unconditionally
# by _denied() below regardless of this list.
DENY_FILES = {"work2.md", "CLAUDE.md"}

MIME = {
    ".html": "text/html; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".pdf": "application/pdf",
}


def _denied(rel):
    """rel: posix-style path relative to ROOT, no leading slash, already
    normalized (no '..', no leading '/'); may name a file or a directory."""
    parts = [p for p in rel.split("/") if p]
    if not parts:
        return False
    if any(p.startswith(".") for p in parts):
        return True
    if rel in DENY_FILES:
        return True
    if parts[0] in ("dev", "hosting"):
        return True
    if rel.endswith(".bak"):
        return True
    return False


def _tracked_files():
    """Returns a set of git-tracked relative paths, or None if this checkout
    is not a git repository (or git is unavailable) -- caller falls back to
    serving the working tree with the deny-list instead."""
    if not os.path.isdir(os.path.join(ROOT, ".git")) or not shutil.which("git"):
        return None
    try:
        out = subprocess.run(
            ["git", "-C", ROOT, "ls-files", "-z"],
            capture_output=True, timeout=15, check=True,
        ).stdout
    except Exception:
        return None
    return {p.decode("utf-8", "surrogateescape") for p in out.split(b"\0") if p}


class Handler(SimpleHTTPRequestHandler):
    allowed = None  # set of tracked paths, or None (deny-list fallback mode)
    server_version = "ResearchRoboServe/1.0"

    def _deny(self):
        # A guaranteed-nonexistent path inside ROOT. open() on it raises a
        # plain FileNotFoundError, which the base class already turns into a
        # normal 404 -- no embedded-NUL-byte tricks, no special-casing needed.
        return os.path.join(ROOT, "__no_such_file__denied__")

    def translate_path(self, path):
        rel = posixpath.normpath(unquote(urlsplit(path).path)).lstrip("/")
        if rel == ".":
            rel = ""
        if rel.startswith("..") or ":" in rel:
            return self._deny()
        if _denied(rel):
            return self._deny()
        full = os.path.realpath(os.path.join(ROOT, rel)) if rel else ROOT
        if not (full == ROOT or full.startswith(ROOT + os.sep)):
            return self._deny()
        if os.path.isdir(full):
            # Let the base class's own send_head() handle the trailing-slash
            # redirect and the index.html lookup (it does both correctly);
            # we only need to have vetted the directory name above.
            return full
        # File request (or a path that doesn't exist at all): enforce the
        # git-tracked whitelist (when available) and refuse symlinks.
        if self.allowed is not None and rel not in self.allowed:
            return self._deny()
        if rel and os.path.islink(os.path.join(ROOT, rel)):
            return self._deny()
        return full

    def list_directory(self, path):  # noqa: N802 (base class name)
        self.send_error(404, "Not Found")
        return None

    def guess_type(self, path):
        if os.path.basename(path) == "LICENSE":
            return "text/plain; charset=utf-8"
        _, ext = posixpath.splitext(path)
        return MIME.get(ext.lower()) or super().guess_type(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, fmt, *args):
        if not getattr(self.server, "quiet", False):
            super().log_message(fmt, *args)


def _lan_ip_hint():
    """Best-effort LAN IP for the "reachable from other devices" message.
    Doesn't actually send any packet (UDP connect() only resolves a route)."""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("198.51.100.1", 1))  # TEST-NET-2, RFC 5737: never routed
            return s.getsockname()[0]
        finally:
            s.close()
    except OSError:
        return None


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("port", nargs="?", default="8080", help="port to bind (0 = OS picks a free port)")
    ap.add_argument("--host", default="127.0.0.1", help="bind address (use 0.0.0.0 to allow LAN access)")
    ap.add_argument("--no-git", action="store_true", help="force deny-list mode even inside a git checkout")
    ap.add_argument("--quiet", action="store_true", help="suppress per-request access log lines")
    args = ap.parse_args()

    try:
        port = int(args.port)
        if not (0 <= port <= 65535):
            raise ValueError
    except ValueError:
        sys.stderr.write("ERROR: port must be an integer 0-65535, got: %r\n" % (args.port,))
        sys.exit(2)

    if not os.path.isfile(os.path.join(ROOT, "index.html")):
        sys.exit("ERROR: %s/index.html not found -- is this the ResearchRobo repo root?" % ROOT)

    Handler.allowed = None if args.no_git else _tracked_files()
    if Handler.allowed is None and not args.quiet:
        sys.stderr.write(
            "WARNING: not a git checkout (or --no-git given); serving the working tree "
            "with a deny-list instead of the git-tracked whitelist.\n"
        )

    httpd = ThreadingHTTPServer((args.host, port), Handler)
    httpd.quiet = args.quiet
    httpd.daemon_threads = True
    actual_port = httpd.server_address[1]
    # First line is plain ASCII (Windows consoles in a non-UTF-8 codepage can choke
    # on Japanese text) and machine-parseable (tests read the port from it).
    # flush=True: stdout is block-buffered (not line-buffered) when piped to a
    # non-tty consumer (e.g. a test harness, or `serve.sh | tee log`), so
    # without an explicit flush this line can sit unread for a long time.
    print("Serving ResearchRobo (git-tracked files only) on http://%s:%s/" % (args.host, actual_port), flush=True)
    if args.host in ("0.0.0.0", "::"):
        lan_ip = _lan_ip_hint()
        if lan_ip:
            print("Also reachable from other devices on this network at: http://%s:%s/" % (lan_ip, actual_port), flush=True)
        else:
            print("Also reachable from other devices on this network at that port.", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
