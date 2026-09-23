#!/usr/bin/env python3
"""Run with Python 3.9+. No third-party dependencies or build step required."""
import argparse
import json
import mimetypes
import os
import re
import sqlite3
import sys
import uuid
import threading
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
from app.domain import INDUSTRIES, FIELD_LABELS
from app.intelligence import ConversationAgent
from app.matching import decorate, ALIASES
from app.profiles import preview as import_profile
from app.store import text_value
from app.store import Store, WorkflowError
from app.auth import Auth
from app.assistant import Assistant, profile_summary
from app.brief_workflow import BriefAgent, CompanyAgent, snapshot


def make_server(host="127.0.0.1", port=8000, db_path=None, orchestrator=None):
    store = Store(db_path or ROOT / "data" / "hackalem.sqlite3")
    agents = orchestrator or AgentOrchestrator()
    intelligence = ConversationAgent(getattr(agents,"provider",None))

    auth=Auth(store)
    assistant=Assistant(getattr(agents,"provider",None))
    brief=BriefAgent(getattr(agents,'provider',None))
    company=CompanyAgent(getattr(agents,'provider',None))

    class Handler(BaseHTTPRequestHandler):
        server_version = "HackAlem/4.0"

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
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
            if getattr(self,"session_cookie",None):self.send_header("Set-Cookie",self.session_cookie)
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
            limit=12000000 if urlsplit(self.path).path=="/api/assistant" else 200000
            if length <= 0 or length > limit:
                raise WorkflowError("Запрос пустой или слишком большой.", 413, "body_size")
            try:
                data = json.loads(self.rfile.read(length).decode("utf-8"))
            except (ValueError, UnicodeError):
                raise WorkflowError("Некорректный JSON.", 400, "invalid_json")
            if not isinstance(data, dict):
                raise WorkflowError("Ожидается JSON-объект.", 400, "invalid_json")
            return data

        def _identity(self):
            self.user=auth.current(self.headers.get('Cookie'))
            if not self.user:raise WorkflowError('Войдите в демо-аккаунт.',401,'unauthorized')
            return self.user['role'],self.user.get('teamId')

        def _cookie(self,token,expire=False):
            secure='; Secure' if (os.environ.get('PUBLIC_ORIGIN','').startswith('https://') or self.headers.get('X-Forwarded-Proto')=='https') else ''
            self.session_cookie='hackalem_session='+token+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+('0' if expire else '86400')+secure

        @staticmethod
        def _require(role, expected):
            if role != expected:
                raise WorkflowError("Это действие доступно только в роли «%s»." % ("Бизнес" if expected == "business" else "Команда"), 403, "forbidden")

        def _origin(self):
            # Reject cross-origin session mutations.
            origin = self.headers.get("Origin")
            expected = (os.environ.get('PUBLIC_ORIGIN') or os.environ.get('RENDER_EXTERNAL_URL') or
                        ('https://'+os.environ['RAILWAY_PUBLIC_DOMAIN'] if os.environ.get('RAILWAY_PUBLIC_DOMAIN') else None) or
                        "http://"+self.headers.get("Host", "")).rstrip('/')
            if origin and origin != expected:
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
                self._send(200, {"ok": True, "aiMode": agents.mode,"version":"4.0"})
                return
            if self.command=='GET' and path=='/api/auth':
                self._send(200,{'user':auth.current(self.headers.get('Cookie')),'accounts':auth.accounts()});return
            if self.command=='POST' and path in ('/api/auth/login','/api/auth/logout'):
                self._origin();data=self._body()
                if path.endswith('/login'):
                    token=auth.login(data.get('email'),data.get('password'),self.client_address[0]);self._cookie(token)
                    self._send(200,{'user':auth.current('hackalem_session='+token)})
                else:
                    auth.logout(self.headers.get('Cookie'));self._cookie('',True);self._send(200,{'ok':True})
                return
            role, team_id = self._identity()
            if self.command == "GET" and path == "/api/bootstrap":
                data = decorate(store.bootstrap(role, team_id,self.user["id"]),role,team_id)
                data["meta"] = {"aiMode": agents.mode, "industries": INDUSTRIES, "skills":list(ALIASES), "version":"4.0"}
                data['user']=self.user
                self._send(200, data)
                return
            if self.command=='GET' and path=='/api/assistant':
                self._send(200,store.assistant_history(self.user['id']));return
            if self.command not in ("POST", "PATCH"):
                raise WorkflowError("Маршрут не найден.", 404, "not_found")
            self._origin()
            data = self._body()
            if self.command=='POST' and path=='/api/assistant/clear':
                store.clear_assistant(self.user['id']);self._send(200,store.assistant_history(self.user['id']));return
            if self.command=='POST' and path=='/api/assistant':
                message=text_value(data.get('message',''),'Сообщение',4000,required=False)
                attachments=data.get('attachments',[])
                if not message and not attachments:raise WorkflowError('Напишите сообщение или добавьте вложение.')
                history=store.assistant_history(self.user['id'])
                if data.get('revision')!=history['revision']:raise WorkflowError('Диалог изменился. Закройте и откройте помощника для обновления.',409)
                context={'role':role,'page':text_value(data.get('page',''),'Страница',100,required=False)}
                visible=decorate(store.bootstrap(role,team_id,self.user['id']),role,team_id)
                viewed_team_id=data.get('teamId')
                if viewed_team_id:
                    viewed_team=next((t for t in visible['teams'] if t['id']==viewed_team_id),None)
                    if not viewed_team:raise WorkflowError('Профиль не найден.',404)
                    context['viewedProfile']={k:v for k,v in viewed_team.items() if k not in ('profilePreview',)}
                context['catalog']=[{'id':t['id'],'title':t['fields']['title'],'industry':t['industry'],'skills':t.get('requiredSkills',[])} for t in visible['tasks'] if t['status']=='published'][:30]
                tid=data.get('taskId')
                if tid:
                    task=next((t for t in visible['tasks'] if t['id']==tid),None)
                    if not task:raise WorkflowError('Эта задача недоступна вашему аккаунту.',403)
                    context['task']={'id':tid,'title':task['fields']['title'] or task.get('draft',''),'fields':task['fields'],'skills':task.get('requiredSkills',[]),'rating':task['score']['total']}
                    if task.get('canEdit'):
                        context['candidates']=[{'name':next(t['name'] for t in visible['teams'] if t['id']==c['teamId']),'score':c['score'],'reasons':c['reasons']} for c in task.get('candidates',[])[:5]]
                if role=='student':
                    context['profile']=store.get_team(team_id)
                    context['profile'].pop('profilePreview',None)
                    ranked=sorted([t for t in visible['tasks'] if t.get('match',{}).get('score') is not None],key=lambda t:-t['match']['score'])[:5]
                    context['recommendations']=[dict(id=t['id'],title=t['fields']['title'],score=t['match']['score'],reason=' '.join(t['match']['reasons'])) for t in ranked]
                result=assistant.respond(message,attachments,history['messages'],context)
                self._send(200,store.save_assistant(self.user['id'],history['revision'],message,result['attachments'],result));return
            summary_match=re.fullmatch(r'/api/teams/([A-Za-z0-9_-]+)/summary',path)
            if self.command=='POST' and summary_match:
                if role!='student' or summary_match[1]!=team_id:raise WorkflowError('Можно обновить только свой профиль.',403)
                team=store.get_team(team_id)
                result=profile_summary(team,getattr(agents,'provider',None))
                self._send(200,{'team':store.save_summary(team_id,team.get('revision',1),result)});return
            if self.command == "POST" and path == "/api/tasks":
                self._require(role, "business")
                self._send(201, {"task": store.create_task(data,self.user["id"])})
                return
            if self.command=='POST' and path=='/api/demo/reset':
                self._require(role,'business')
                if data.get('confirmed') is not True: raise WorkflowError('Подтвердите сброс учебного примера.')
                self._send(200,{'task':store.reset_demo(self.user["id"])}); return
            profile_match=re.fullmatch(r'/api/teams/([A-Za-z0-9_-]+)/profile(?:/(import))?',path)
            if profile_match:
                self._require(role,'student')
                target,action=profile_match.groups()
                if target!=team_id: raise WorkflowError('Можно менять только выбранный профиль.',403)
                if action=='import' and self.command=='POST':
                    team=store.get_team(team_id)
                    result=import_profile(data,getattr(agents,'provider',None))
                    saved=store.profile_preview(team_id,result,team.get('revision',1))
                elif action is None and self.command=='PATCH': saved=store.update_profile(team_id,data)
                else: raise WorkflowError('Маршрут не найден.',404)
                self._send(200,{'team':saved}); return
            flow=re.fullmatch(r'/api/tasks/([A-Za-z0-9_-]+)/(brief-extract|brief-assess|company-research|brief-finish|qualification-answers)',path)
            if flow and self.command=='POST':
                self._require(role,'business')
                task_id,action=flow.groups();task=store.assert_owner(task_id,self.user['id'])
                if action=='company-research':
                    saved,run_id=store.start_research(task_id)
                    if run_id:
                        def research_job():
                            try:result=company.research(task['draft'])
                            except Exception:result={'status':'unavailable','sources':[],'summary':'','mode':'local','warning':'Поиск недоступен. Используется описание бизнеса.'}
                            store.finish_research(task_id,run_id,result)
                        threading.Thread(target=research_job,daemon=True).start()
                else:
                    store._revision(task,data.get('revision'))
                    if action=='brief-extract':
                        if any(task['fields'].values()):raise WorkflowError('Поля уже заполнены; отредактируйте их вручную.',409)
                        saved=store.save_brief(task_id,task['revision'],'briefExtraction',brief.extract(task['draft']))
                    elif action=='brief-assess':saved=store.save_brief(task_id,task['revision'],'briefAssessment',brief.assess(task))
                    elif action=='brief-finish':
                        store.require_brief_finished(task,data.get('confirmed'))
                        saved=store.save_qualification(task_id,task['revision'],company.questions(task),snapshot(task))
                    else:
                        answers=store.qualification_answers(task,data)
                        saved=store.save_recommendations(task_id,task['revision'],data.get('questionSetId'),answers,company.recommend(task,answers))
                self._send(200,{'task':saved});return
            extra=re.fullmatch(r'/api/tasks/([A-Za-z0-9_-]+)/(chat|chat-compose|skills-suggest|skills|review|review-resolve)',path)
            if extra and self.command=='POST':
                self._require(role,'business')
                task_id,action=extra.groups(); task=store.assert_owner(task_id,self.user["id"])
                store._revision(task,data.get('revision'))
                if action=='chat':
                    if task['status']!='draft': raise WorkflowError('Переписка доступна для черновиков.',409)
                    message=text_value(data.get('message',''),'Сообщение',4000,required=False)
                    history=task.get('conversation',[])
                    if not message and history: raise WorkflowError('Введите сообщение.')
                    if len(history)>=200 or sum(len(x['content']) for x in history)+len(message)>100000:
                        raise WorkflowError('Достигнут лимит диалога. История сохранена; сформируйте и отредактируйте карточку.')
                    turn_id='u-'+uuid.uuid4().hex
                    response=intelligence.respond(task,message,turn_id)
                    saved=store.save_chat(task_id,task['revision'],message,turn_id,response)
                elif action=='chat-compose':
                    saved=store.compose_chat(task_id,task['revision'])
                    composed_trace=saved['ai']['trace']
                    suggestions=intelligence.suggest_skills(saved)
                    suggestions['trace']=composed_trace+suggestions['trace']
                    saved=store.save_insight(task_id,saved['revision'],'skillSuggestions',suggestions)
                elif action=='skills-suggest': saved=store.save_insight(task_id,task['revision'],'skillSuggestions',intelligence.suggest_skills(task))
                elif action=='skills': saved=store.confirm_skills(task_id,data)
                elif action=='review': saved=store.save_insight(task_id,task['revision'],'review',intelligence.review(task))
                else: saved=store.resolve_review(task_id,data)
                self._send(200,{'task':saved,'ai':saved.get('ai',{})}); return
            match = re.fullmatch(r"/api/tasks/([A-Za-z0-9_-]+)(?:/(questions|compose|publish|proposals))?", path)
            if match:
                task_id, action = match.groups()
                if action!="proposals":
                    self._require(role,"business");store.assert_owner(task_id,self.user["id"])
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
                if action!="submit-stage":
                    self._require(role,"business");store.assert_owner(store.proposal_task(proposal_id),self.user["id"])
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
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT","8000")))
    parser.add_argument("--db", type=Path, default=Path(os.environ.get("DATABASE_PATH",str(ROOT / "data" / "hackalem.sqlite3"))))
    parser.add_argument('--host',default=os.environ.get('HOST','127.0.0.1'))
    parser.add_argument('--public-origin',help='Public HTTPS URL for a tunnel')
    args = parser.parse_args()
    if args.public_origin:
        url=urlsplit(args.public_origin)
        if url.scheme!='https' or not url.hostname or url.path not in ('','/') or url.query or url.fragment or url.username:
            parser.error('--public-origin: укажите HTTPS-адрес без пути, скобок и Markdown.')
        os.environ['PUBLIC_ORIGIN']=args.public_origin.rstrip('/')
    try:
        server = make_server(host=args.host, port=args.port, db_path=args.db)
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
