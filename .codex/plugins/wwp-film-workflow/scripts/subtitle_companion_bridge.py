#!/usr/bin/env python3
"""Local task bridge for browser-resident subtitle provider companions."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
import urllib.parse
import urllib.request


SERVICE_NAME = "wwp-subtitle-companion-bridge"
TASK_SCHEMA = "wwp-subtitle-search.v1"
DEFAULT_PORT_START = 8818
DEFAULT_PORT_END = 8838
DEFAULT_IDLE_TIMEOUT = 900
CLAIM_SECONDS = 180
TERMINAL_STATUSES = {"downloaded", "selected", "deferred"}
KNOWN_STATUSES = {
    "ready",
    "claimed",
    "candidates_ready",
    "downloaded",
    "selected",
    "failed",
    "deferred",
}


class BridgeError(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def parse_utc(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def canonical_workspace(value: Path) -> Path:
    return value.expanduser().resolve()


def state_dir(workspace: Path) -> Path:
    return canonical_workspace(workspace) / ".local-data" / "wwp-subtitle-bridge"


def tasks_dir(workspace: Path) -> Path:
    return state_dir(workspace) / "tasks"


def bridge_state_path(workspace: Path) -> Path:
    return state_dir(workspace) / "bridge-state.json"


def companion_userscript_path() -> Path:
    return Path(__file__).resolve().parent.parent / "assets" / "userscript" / "wwp-subtitle-companion.user.js"


def task_path(workspace: Path, task_id: str) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9._-]+", task_id):
        raise BridgeError("Invalid task id")
    return tasks_dir(workspace) / f"{task_id}.json"


def atomic_write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + f".{secrets.token_hex(4)}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BridgeError(f"Cannot read JSON: {path}") from exc
    if not isinstance(value, dict):
        raise BridgeError(f"Expected JSON object: {path}")
    return value


def normalize_request(value: dict[str, Any]) -> dict[str, Any]:
    work = value.get("work")
    source = value.get("source")
    if not isinstance(work, dict) or not str(work.get("title", "")).strip():
        raise BridgeError("request.work.title is required")
    if not isinstance(source, dict):
        raise BridgeError("request.source is required")
    languages = value.get("languages", ["zh-Hant", "zh-Hans"])
    providers = value.get("providers", ["subhd"])
    if not isinstance(languages, list) or not all(isinstance(item, str) and item for item in languages):
        raise BridgeError("request.languages must be a non-empty string array")
    if not isinstance(providers, list) or not all(re.fullmatch(r"[a-z0-9_-]+", str(item)) for item in providers):
        raise BridgeError("request.providers must contain provider ids")
    normalized = dict(value)
    normalized["work"] = work
    normalized["source"] = source
    normalized["languages"] = list(dict.fromkeys(languages))
    normalized["providers"] = list(dict.fromkeys(providers))
    return normalized


def task_digest(request: dict[str, Any]) -> str:
    payload = json.dumps(request, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def safe_slug(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip("-._")
    return cleaned[:50] or "subtitle"


def create_task(workspace: Path, request: dict[str, Any]) -> dict[str, Any]:
    workspace = canonical_workspace(workspace)
    normalized = normalize_request(request)
    digest = task_digest(normalized)
    work = normalized["work"]
    base = safe_slug(str(work.get("originalTitle") or work.get("title") or "subtitle"))
    task_id = f"{base}-{digest[:12]}"
    path = task_path(workspace, task_id)
    if path.exists():
        existing = read_json(path)
        if existing.get("hash") == digest and existing.get("schema") == TASK_SCHEMA:
            return existing
    now = utc_now()
    task = {
        "schema": TASK_SCHEMA,
        "id": task_id,
        "hash": digest,
        "status": "ready",
        "createdAt": now,
        "updatedAt": now,
        "request": normalized,
        "claim": None,
        "providerResults": {},
        "events": [{"at": now, "type": "ready"}],
    }
    atomic_write_json(path, task)
    return task


def claim_expired(task: dict[str, Any]) -> bool:
    claim = task.get("claim")
    if not isinstance(claim, dict):
        return False
    expires_at = parse_utc(str(claim.get("expiresAt", "")))
    return bool(expires_at and expires_at <= datetime.now(timezone.utc))


def refresh_claim(path: Path, task: dict[str, Any]) -> dict[str, Any]:
    if task.get("status") == "claimed" and claim_expired(task):
        now = utc_now()
        task["status"] = "ready"
        task["claim"] = None
        task["updatedAt"] = now
        task.setdefault("events", []).append({"at": now, "type": "claim-expired"})
        atomic_write_json(path, task)
    return task


def all_tasks(workspace: Path) -> list[dict[str, Any]]:
    directory = tasks_dir(workspace)
    if not directory.exists():
        return []
    values: list[dict[str, Any]] = []
    for path in directory.glob("*.json"):
        try:
            task = refresh_claim(path, read_json(path))
        except BridgeError:
            continue
        if task.get("schema") == TASK_SCHEMA:
            values.append(task)
    return sorted(values, key=lambda item: str(item.get("updatedAt", "")), reverse=True)


def public_summary(task: dict[str, Any]) -> dict[str, Any]:
    request = task.get("request", {})
    return {
        "id": task.get("id"),
        "hash": task.get("hash"),
        "status": task.get("status"),
        "updatedAt": task.get("updatedAt"),
        "work": request.get("work", {}),
        "source": request.get("source", {}),
        "languages": request.get("languages", []),
        "providers": request.get("providers", []),
        "providerResultCounts": {
            key: len(value.get("candidates", []))
            for key, value in task.get("providerResults", {}).items()
            if isinstance(value, dict)
        },
    }


def public_task(task: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in task.items() if key not in {"claim"}}


def health_url(port: int) -> str:
    return f"http://127.0.0.1:{port}/health"


def healthy_state(state: dict[str, Any]) -> bool:
    try:
        with urllib.request.urlopen(health_url(int(state["port"])), timeout=0.5) as response:
            payload = json.loads(response.read())
        return payload.get("service") == SERVICE_NAME and payload.get("instanceId") == state.get("instanceId")
    except Exception:
        return False


def read_state(workspace: Path) -> dict[str, Any] | None:
    path = bridge_state_path(workspace)
    if not path.exists():
        return None
    try:
        return read_json(path)
    except BridgeError:
        return None


def spawn_server(workspace: Path, port_start: int, port_end: int, idle_timeout: int) -> None:
    command = [
        sys.executable,
        str(Path(__file__).resolve()),
        "serve",
        "--workspace",
        str(canonical_workspace(workspace)),
        "--port-start",
        str(port_start),
        "--port-end",
        str(port_end),
        "--idle-timeout",
        str(idle_timeout),
    ]
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    subprocess.Popen(
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
        creationflags=creationflags,
    )


def ensure_bridge(workspace: Path, port_start: int, port_end: int, idle_timeout: int) -> dict[str, Any]:
    workspace = canonical_workspace(workspace)
    directory = state_dir(workspace)
    directory.mkdir(parents=True, exist_ok=True)
    lock = directory / "start.lock"
    deadline = time.monotonic() + 8
    lock_fd: int | None = None
    while time.monotonic() < deadline:
        state = read_state(workspace)
        if state and healthy_state(state):
            return state
        try:
            lock_fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(lock_fd, f"{os.getpid()} {time.time()}".encode("ascii"))
            break
        except FileExistsError:
            try:
                if time.time() - lock.stat().st_mtime > 15:
                    lock.unlink(missing_ok=True)
            except OSError:
                pass
            time.sleep(0.15)
    if lock_fd is None:
        raise BridgeError("Timed out waiting for Bridge startup lock")
    try:
        state = read_state(workspace)
        if state and healthy_state(state):
            return state
        spawn_server(workspace, port_start, port_end, idle_timeout)
        for _ in range(60):
            time.sleep(0.1)
            state = read_state(workspace)
            if state and healthy_state(state):
                return state
        raise BridgeError("Bridge did not become healthy")
    finally:
        if lock_fd is not None:
            os.close(lock_fd)
        lock.unlink(missing_ok=True)


class BridgeServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], workspace: Path, instance_id: str, token: str):
        super().__init__(address, BridgeHandler)
        self.workspace = canonical_workspace(workspace)
        self.instance_id = instance_id
        self.token = token
        self.last_activity = time.monotonic()


class BridgeHandler(BaseHTTPRequestHandler):
    server: BridgeServer

    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def send_json(self, status: int, value: Any) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def authorized(self) -> bool:
        token = self.headers.get("X-WWP-Subtitle-Token", "")
        if not token:
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            token = query.get("bridgeToken", [""])[0]
        return secrets.compare_digest(token, self.server.token)

    def require_authorized(self) -> bool:
        if self.authorized():
            self.server.last_activity = time.monotonic()
            return True
        self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
        return False

    def read_body(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise BridgeError("Invalid Content-Length") from exc
        if length < 0 or length > 2_000_000:
            raise BridgeError("Request body is too large")
        try:
            value = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError as exc:
            raise BridgeError("Invalid JSON body") from exc
        if not isinstance(value, dict):
            raise BridgeError("Expected JSON object")
        return value

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path == "/health":
            self.send_json(HTTPStatus.OK, {
                "service": SERVICE_NAME,
                "version": 1,
                "instanceId": self.server.instance_id,
                "port": self.server.server_port,
                "token": self.server.token,
                "installUrl": f"http://127.0.0.1:{self.server.server_port}/install/wwp-subtitle-companion.user.js",
            })
            return
        if parsed.path == "/install/wwp-subtitle-companion.user.js":
            userscript = companion_userscript_path()
            try:
                content = userscript.read_bytes()
            except OSError:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "userscript-not-found"})
                return
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(content)
            return
        if not self.require_authorized():
            return
        query = urllib.parse.parse_qs(parsed.query)
        if parsed.path == "/v1/tasks":
            provider = query.get("provider", [""])[0]
            statuses = set(query.get("status", []))
            tasks = all_tasks(self.server.workspace)
            if provider:
                tasks = [task for task in tasks if provider in task.get("request", {}).get("providers", [])]
            if statuses:
                tasks = [task for task in tasks if task.get("status") in statuses]
            self.send_json(HTTPStatus.OK, {"tasks": [public_summary(task) for task in tasks]})
            return
        match = re.fullmatch(r"/v1/tasks/([^/]+)", parsed.path)
        if match:
            try:
                task_id = urllib.parse.unquote(match.group(1))
                path = task_path(self.server.workspace, task_id)
                task = refresh_claim(path, read_json(path))
                self.send_json(HTTPStatus.OK, public_task(task))
            except BridgeError:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "task-not-found"})
            return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "not-found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlsplit(self.path)
        if not self.require_authorized():
            return
        match = re.fullmatch(r"/v1/tasks/([^/]+)/(claim|candidates|result)", parsed.path)
        if not match:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not-found"})
            return
        try:
            task_id = urllib.parse.unquote(match.group(1))
            action = match.group(2)
            body = self.read_body()
            path = task_path(self.server.workspace, task_id)
            task = refresh_claim(path, read_json(path))
            if body.get("hash") != task.get("hash"):
                raise BridgeError("Task hash mismatch")
            provider = str(body.get("provider", ""))
            client_id = str(body.get("clientId", ""))
            if provider not in task.get("request", {}).get("providers", []):
                raise BridgeError("Provider is not allowed for this task")
            if not client_id:
                raise BridgeError("clientId is required")
            now = datetime.now(timezone.utc).replace(microsecond=0)
            if action == "claim":
                if task.get("status") in TERMINAL_STATUSES:
                    raise BridgeError(f"Task status is terminal: {task.get('status')}")
                existing = task.get("claim")
                if task.get("status") == "claimed" and isinstance(existing, dict) and existing.get("clientId") != client_id:
                    self.send_json(HTTPStatus.CONFLICT, {"error": "task-already-claimed"})
                    return
                task["status"] = "claimed"
                task["claim"] = {
                    "provider": provider,
                    "clientId": client_id,
                    "claimedAt": now.isoformat(),
                    "expiresAt": (now + timedelta(seconds=CLAIM_SECONDS)).isoformat(),
                }
                task["updatedAt"] = now.isoformat()
                task.setdefault("events", []).append({"at": now.isoformat(), "type": "claimed", "provider": provider})
                atomic_write_json(path, task)
                self.send_json(HTTPStatus.OK, {"status": "claimed"})
                return
            claim = task.get("claim")
            if not isinstance(claim, dict) or claim.get("clientId") != client_id or claim.get("provider") != provider:
                raise BridgeError("Task is not claimed by this provider client")
            if action == "candidates":
                candidates = body.get("candidates")
                if not isinstance(candidates, list) or len(candidates) > 100:
                    raise BridgeError("candidates must be an array with at most 100 items")
                cleaned = [candidate for candidate in candidates if isinstance(candidate, dict)]
                result = {
                    "provider": provider,
                    "pageUrl": str(body.get("pageUrl", ""))[:2000],
                    "query": str(body.get("query", ""))[:500],
                    "capturedAt": now.isoformat(),
                    "candidates": cleaned,
                }
                task.setdefault("providerResults", {})[provider] = result
                task["status"] = "candidates_ready"
                task["claim"] = None
                task["updatedAt"] = now.isoformat()
                task.setdefault("events", []).append({
                    "at": now.isoformat(), "type": "candidates-ready", "provider": provider, "count": len(cleaned)
                })
                atomic_write_json(path, task)
                self.send_json(HTTPStatus.OK, {"status": "candidates_ready", "count": len(cleaned)})
                return
            result_status = str(body.get("status", ""))
            if result_status not in {"downloaded", "selected", "failed", "deferred"}:
                raise BridgeError("Invalid result status")
            task["status"] = result_status
            task["claim"] = None
            task["updatedAt"] = now.isoformat()
            task["lastResult"] = {
                "provider": provider,
                "pageUrl": str(body.get("pageUrl", ""))[:2000],
                "candidateId": str(body.get("candidateId", ""))[:300],
                "artifactPath": str(body.get("artifactPath", ""))[:2000],
                "note": str(body.get("note", ""))[:1000],
            }
            task.setdefault("events", []).append({
                "at": now.isoformat(), "type": result_status, "provider": provider,
                "note": str(body.get("note", ""))[:500] or None,
            })
            atomic_write_json(path, task)
            self.send_json(HTTPStatus.OK, {"status": result_status})
        except (BridgeError, OSError) as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})


def serve(workspace: Path, port_start: int, port_end: int, idle_timeout: int) -> int:
    if port_start < 1024 or port_end < port_start or port_end > 65535:
        raise BridgeError("Invalid port range")
    instance_id = secrets.token_hex(12)
    token = secrets.token_urlsafe(32)
    server: BridgeServer | None = None
    for port in range(port_start, port_end + 1):
        try:
            server = BridgeServer(("127.0.0.1", port), workspace, instance_id, token)
            break
        except OSError:
            continue
    if server is None:
        raise BridgeError(f"No free port in {port_start}-{port_end}")
    state = {
        "service": SERVICE_NAME,
        "instanceId": instance_id,
        "pid": os.getpid(),
        "port": server.server_port,
        "startedAt": utc_now(),
        "workspace": str(canonical_workspace(workspace)),
    }
    atomic_write_json(bridge_state_path(workspace), state)
    server.timeout = 1
    try:
        while time.monotonic() - server.last_activity < idle_timeout:
            server.handle_request()
    finally:
        server.server_close()
        current = read_state(workspace)
        if current and current.get("instanceId") == instance_id:
            bridge_state_path(workspace).unlink(missing_ok=True)
    return 0


def add_bridge_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--workspace", type=Path, default=Path.cwd())
    parser.add_argument("--port-start", type=int, default=DEFAULT_PORT_START)
    parser.add_argument("--port-end", type=int, default=DEFAULT_PORT_END)
    parser.add_argument("--idle-timeout", type=int, default=DEFAULT_IDLE_TIMEOUT)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    create = subparsers.add_parser("create-task", help="Create or reuse one subtitle search task")
    add_bridge_options(create)
    create.add_argument("--request", type=Path, required=True)
    create.add_argument("--no-ensure", action="store_true")
    ensure = subparsers.add_parser("ensure", help="Start or reuse the local Bridge")
    add_bridge_options(ensure)
    listing = subparsers.add_parser("list", help="List local subtitle tasks")
    listing.add_argument("--workspace", type=Path, default=Path.cwd())
    retry = subparsers.add_parser("retry", help="Return a failed/deferred task to Ready")
    add_bridge_options(retry)
    retry.add_argument("--task", required=True)
    serve_parser = subparsers.add_parser("serve", help=argparse.SUPPRESS)
    add_bridge_options(serve_parser)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        workspace = canonical_workspace(args.workspace)
        if args.command == "create-task":
            task = create_task(workspace, read_json(args.request.resolve()))
            state = None if args.no_ensure else ensure_bridge(workspace, args.port_start, args.port_end, args.idle_timeout)
            print(json.dumps({"task": public_summary(task), "bridge": state}, ensure_ascii=False, indent=2))
        elif args.command == "ensure":
            print(json.dumps(ensure_bridge(workspace, args.port_start, args.port_end, args.idle_timeout), ensure_ascii=False, indent=2))
        elif args.command == "list":
            print(json.dumps({"tasks": [public_summary(task) for task in all_tasks(workspace)]}, ensure_ascii=False, indent=2))
        elif args.command == "retry":
            path = task_path(workspace, args.task)
            task = read_json(path)
            if task.get("status") in TERMINAL_STATUSES and task.get("status") != "deferred":
                raise BridgeError(f"Refusing to retry terminal status {task.get('status')}")
            now = utc_now()
            task["status"] = "ready"
            task["claim"] = None
            task["updatedAt"] = now
            task.setdefault("events", []).append({"at": now, "type": "ready-retry"})
            atomic_write_json(path, task)
            state = ensure_bridge(workspace, args.port_start, args.port_end, args.idle_timeout)
            print(json.dumps({"task": public_summary(task), "bridge": state}, ensure_ascii=False, indent=2))
        elif args.command == "serve":
            return serve(workspace, args.port_start, args.port_end, args.idle_timeout)
        return 0
    except BridgeError as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
