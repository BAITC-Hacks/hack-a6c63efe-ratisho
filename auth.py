"""Cookie sessions and deliberately public demo credentials. No role headers."""
import hashlib
import hmac
import secrets
import time
from http.cookies import SimpleCookie, CookieError
from .demo import BUSINESSES
from .store import WorkflowError

DEMO_PASSWORD='hackalem2026'

def digest(password,salt):
    return hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(salt),180000).hex()

class Auth:
    def __init__(self,store):
        self.store=store
        with store.connection(write=True) as db:
            db.execute('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,team_id TEXT,salt TEXT NOT NULL,password_hash TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS login_attempts (client TEXT PRIMARY KEY,attempts INTEGER NOT NULL,until INTEGER NOT NULL)')
            users=[(id,email,name,'business',None) for id,email,name in BUSINESSES]
            users += [('u-'+t['id'],'student%s@demo.local'%t['id'][1:] if t['id']!='t1' else 'student@demo.local',t['name'],'student',t['id']) for t in store._teams(db)]
            for values in users:
                if db.execute('SELECT 1 FROM users WHERE id=?',(values[0],)).fetchone():continue
                salt=secrets.token_hex(16)
                db.execute('INSERT INTO users VALUES (?,?,?,?,?,?,?)',(*values,salt,digest(DEMO_PASSWORD,salt)))
    def accounts(self):
        with self.store.connection() as db:
            return [dict(id=r[0],email=r[1],name=r[2],role=r[3],teamId=r[4]) for r in db.execute('SELECT id,email,name,role,team_id FROM users ORDER BY role,id')]
    def current(self,cookie):
        parsed=SimpleCookie()
        try:parsed.load(cookie or '');token=parsed['hackalem_session'].value
        except (KeyError,ValueError,CookieError):return None
        with self.store.connection() as db:
            row=db.execute('SELECT u.id,u.email,u.name,u.role,u.team_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?',(hashlib.sha256(token.encode()).hexdigest(),int(time.time()))).fetchone()
        return dict(id=row[0],email=row[1],name=row[2],role=row[3],teamId=row[4]) if row else None
    def login(self,email,password,client):
        if not isinstance(email,str) or not isinstance(password,str) or len(email)>200 or len(password)>200:raise WorkflowError('Проверьте логин и пароль.',401)
        now=int(time.time())
        with self.store.connection(write=True) as db:
            row=db.execute('SELECT attempts,until FROM login_attempts WHERE client=?',(client,)).fetchone()
            attempts=row[0] if row and row[1]>now else 0
            if attempts>=20:raise WorkflowError('Слишком много попыток. Повторите через минуту.',429)
            db.execute('INSERT INTO login_attempts VALUES (?,?,?) ON CONFLICT(client) DO UPDATE SET attempts=excluded.attempts,until=excluded.until',(client,attempts+1,now+60))
            user=db.execute('SELECT id,salt,password_hash FROM users WHERE email=?',(email.strip().lower(),)).fetchone()
        valid=hmac.compare_digest(digest(password,user[1] if user else '00'*16),user[2] if user else '0'*64)
        if not user or not valid:raise WorkflowError('Неверный логин или пароль.',401,'login')
        token=secrets.token_urlsafe(32)
        with self.store.connection(write=True) as db:
            db.execute('DELETE FROM sessions WHERE expires<=?',(now,))
            db.execute('INSERT INTO sessions VALUES (?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),user[0],now+86400))
            db.execute('DELETE FROM login_attempts WHERE client=?',(client,))
        return token
    def logout(self,cookie):
        parsed=SimpleCookie()
        try:parsed.load(cookie or '');token=parsed['hackalem_session'].value
        except (ValueError,KeyError,CookieError):return
        with self.store.connection(write=True) as db:db.execute('DELETE FROM sessions WHERE token_hash=?',(hashlib.sha256(token.encode()).hexdigest(),))
