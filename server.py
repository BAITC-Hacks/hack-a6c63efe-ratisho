#!/usr/bin/env python3
"""Run with Python 3.9+. No third-party dependencies or build step required."""
import argparse
import json
import mimetypes
import os
import re
import sqlite3
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent


def load_environment():
    envfile = ROOT / ".env"
    if envfile.is_file():
        for line in envfile.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip()
            if key.startswith("AI_") and re.fullmatch(r"AI_[A-Z0-9_]+", key):
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                os.environ.setdefault(key, value)


load_environment()
from app.agents import AgentOrchestrator
from app.domain import INDUSTRIES
from app.store import Store, WorkflowError


def make_server(host="127.0.0.1", port=8000, db_path=None, orchestrator=None):
    store = Store(db_path or ROOT / "data" / "hackalem.sqlite3")
    agents = orchestrator or AgentOrchestrator()

    class Handler(BaseHTTPRequestHandler):
        server_version = "HackAlem/1.0"

        def log_message(self, fmt, *args):
            # Access metadata only; never print submitted briefs, answers or credentials.
            sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))

        def _send(self, status, content, content_type="application/json; charset=utf-8"):
            if isinstance(content, (dict, list)):
                content = json.dumps(content, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store" if content_type.startswith("application/json") else "no-cache")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "same-origin")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(content)

        def _body(self):
            if self.headers.get_content_type() != "application/json":
                raise WorkflowError("Используйте Content-Type: application/json.", 415, "content_type")
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                raise WorkflowError("Некорректная длина запроса.", 400, "invalid_json")
            if length <= 0 or length > 200000:
                raise WorkflowError("Запрос пустой или слишком большой.", 413, "body_size")
            try:
                data = json.loads(self.rfile.read(length).decode("utf-8"))
            except (ValueError, UnicodeError):
                raise WorkflowError("Некорректный JSON.", 400, "invalid_json")
            if not isinstance(data, dict):
                raise WorkflowError("Ожидается JSON-объект.", 400, "invalid_json")
            return data

        def _identity(self):
            role = self.headers.get("X-Role", "business")
            if role not in ("business", "student"):
                raise WorkflowError("Неизвестная роль.", 403, "forbidden")
            team_id = self.headers.get("X-Team-Id", "t1")
            if role == "student":
                store.require_team(team_id)
            return role, team_id

        @staticmethod
        def _require(role, expected):
            if role != expected:
                raise WorkflowError("Это действие доступно только в роли «%s»." % ("Бизнес" if expected == "business" else "Команда"), 403, "forbidden")

        def _origin(self):
            # Demo roles are deliberately selectable. Block cross-origin browser writes.
            origin = self.headers.get("Origin")
            expected_origin = os.environ.get("PUBLIC_ORIGIN", "http://" + self.headers.get("Host", "")).rstrip("/")
            if origin and origin != expected_origin:
                raise WorkflowError("Запрос с другого сайта запрещён.", 403, "origin")
            if self.headers.get("Sec-Fetch-Site") == "cross-site":
                raise WorkflowError("Запрос с другого сайта запрещён.", 403, "origin")

        def _dispatch(self):
            path = urlsplit(self.path).path
            if not path.startswith("/api/"):
                if self.command not in ("GET", "HEAD"):
                    raise WorkflowError("Метод не поддерживается.", 405, "method")
                rel = unquote(path).lstrip("/") or "index.html"
                file = (ROOT / "static" / rel).resolve()
                if ROOT / "static" not in file.parents or not file.is_file():
                    raise WorkflowError("Страница не найдена.", 404, "not_found")
                content_type = mimetypes.guess_type(str(file))[0] or "application/octet-stream"
                if content_type.startswith("text/") or content_type == "application/javascript":
                    content_type += "; charset=utf-8"
                self._send(200, file.read_bytes(), content_type)
                return
            if self.command == "GET" and path == "/api/health":
                self._send(200, {"ok": True, "aiMode": agents.mode})
                return
            role, team_id = self._identity()
            if self.command == "GET" and path == "/api/bootstrap":
                data = store.bootstrap(role, team_id)
                data["meta"] = {"aiMode": agents.mode, "industries": INDUSTRIES}
                self._send(200, data)
                return
            if self.command not in ("POST", "PATCH"):
                raise WorkflowError("Маршрут не найден.", 404, "not_found")
            self._origin()
            data = self._body()
            if self.command == "POST" and path == "/api/tasks":
                self._require(role, "business")
                self._send(201, {"task": store.create_task(data)})
                return
            match = re.fullmatch(r"/api/tasks/([A-Za-z0-9_-]+)(?:/(questions|compose|publish|proposals))?", path)
            if match:
                task_id, action = match.groups()
                if self.command == "PATCH" and action is None:
                    self._require(role, "business")
                    result = {"task": store.update_task(task_id, data)}
                elif self.command == "POST" and action == "proposals":
                    self._require(role, "student")
                    self._send(201, {"proposal": store.create_proposal(task_id, team_id, data)})
                    return
                elif self.command == "POST" and action == "publish":
                    self._require(role, "business")
                    result = {"task": store.publish_task(task_id, data)}
                elif self.command == "POST" and action in ("questions", "compose"):
                    self._require(role, "business")
                    task = store.get_task(task_id)
                    if task["status"] != "draft":
                        raise WorkflowError("AI-конструктор доступен для неопубликованных черновиков.", 409, "already_published")
                    if action == "questions":
                        response = agents.questions(task["draft"], task["industry"], task["fields"])
                        saved = store.save_ai(task_id, task["revision"], response)
                        result = {"task": saved, "questions": response["questions"]}
                    else:
                        answers = data.get("answers")
                        response = agents.compose(task["draft"], task["industry"], answers, task["fields"])
                        saved = store.save_ai(task_id, task["revision"], response, answers=answers)
                        result = {"task": saved}
                    result["ai"] = {key: response.get(key) for key in ("mode", "warning", "trace")}
                else:
                    raise WorkflowError("Маршрут не найден.", 404, "not_found")
                self._send(200, result)
                return
            match = re.fullmatch(r"/api/proposals/([A-Za-z0-9_-]+)/(decision|submit-stage|confirm-stage)", path)
            if match and self.command == "POST":
                proposal_id, action = match.groups()
                if action == "decision":
                    self._require(role, "business")
                    result = {"proposal": store.decide(proposal_id, data)}
                elif action == "submit-stage":
                    self._require(role, "student")
                    result = {"proposal": store.submit_stage(proposal_id, team_id, data)}
                else:
                    self._require(role, "business")
                    result = store.confirm_stage(proposal_id)
                self._send(200, result)
                return
            raise WorkflowError("Маршрут не найден.", 404, "not_found")

        def _handle(self):
            try:
                self._dispatch()
            except WorkflowError as exc:
                self._send(exc.status, {"error": str(exc), "code": exc.code})
            except ValueError as exc:
                self._send(422, {"error": str(exc), "code": "validation"})
            except sqlite3.Error:
                self._send(503, {"error": "Не удалось сохранить данные. Повторите попытку.", "code": "storage"})
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as exc:
                sys.stderr.write("Internal error: %s\n" % type(exc).__name__)
                self._send(500, {"error": "Внутренняя ошибка. Введённые данные остаются в форме.", "code": "internal"})

        do_GET = _handle
        do_HEAD = _handle
        do_POST = _handle
        do_PATCH = _handle

    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    server.store = store
    return server


def main():
    parser = argparse.ArgumentParser(description="HackAlem — локальный MVP")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--db", type=Path, default=ROOT / "data" / "hackalem.sqlite3")
    parser.add_argument("--public-origin", help="Exact public HTTPS URL of the tunnel")
    args = parser.parse_args()
    if args.public_origin:
        parsed = urlsplit(args.public_origin)
        if parsed.scheme != "https" or not parsed.netloc or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
            parser.error("--public-origin must be an HTTPS origin without a path")
        os.environ["PUBLIC_ORIGIN"] = args.public_origin.rstrip("/")
    try:
        server = make_server(port=args.port, db_path=args.db)
    except OSError as exc:
        parser.exit(1, "Не удалось запустить сервер: %s. Попробуйте --port 8001.\n" % exc)
    print("HackAlem: http://127.0.0.1:%s\nДля остановки нажмите Ctrl+C." % server.server_port, flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
