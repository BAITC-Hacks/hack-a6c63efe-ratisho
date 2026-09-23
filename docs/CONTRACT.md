# Implementation contract

Scope: HackAlem / AI Sana specification. Russian UI. Python 3.9+ standard library backend, SQLite, vanilla ES modules/CSS; no required pip/npm packages. Run `python3 server.py`. Local ZIP delivery.

## Fields and score
Task `fields` keys: title, context, need, users, data, constraints, outcome, success, contact, interaction. Values are strings. Additional `industry` string.
Score weights: context 10 + need 10; data 20; outcome 15; success 15; constraints 10; users 10; contact 5 + interaction 5 = 100. A field counts only if nonblank, meaningful (not placeholder), and in confirmedFields. title required for publication but unscored. Levels: draft 0–39, working 40–69, ready 70–89, priority 90–100.
Task object: {id,draft,industry,fields,confirmedFields,status:'draft'|'published',revision,createdAt,updatedAt,questions:[],answers:{},score}. score: {total,level,levelLabel,breakdown:[{id,label,weight,earned,missingFields}],missingFields:[fieldName],suggestions:[string]}.
Question: {id: fieldName,field: fieldName,text:string}. At least 3 relevant questions. All 10 fields editable. Low-score publication and proposals allowed. Published edits clear confirmations for changed fields; new confirmation must be explicit. Human publication confirmation remains required.

## HTTP contract
JSON requests/responses. Errors {error:string,code:string}; status 400/403/404/409/422/503. API client sends X-Role: business|student and X-Team-Id (one of t1..t5). Demo role switch, not real authentication. No secrets in browser.
- GET /api/bootstrap -> {tasks,teams,proposals,meta:{aiMode,industries}}. Business sees all tasks/proposals; students published tasks and own proposals. Sorted by score descending, stable id tie-break. Teams {id,name,interests:[string],skills:[string],technologies:[string],points:number}.
- GET /api/health -> {ok:true,aiMode}
- POST /api/tasks {draft,industry} -> {task}
- POST /api/tasks/:id/questions {} -> {task,questions,ai:{mode,warning,trace}}
- POST /api/tasks/:id/compose {answers:{field:string}} -> {task,ai:{mode,warning,trace}}
- PATCH /api/tasks/:id {fields,confirmedFields,industry,revision} -> {task}. Send full fields/confirmedFields. Stale revision gives 409. Explicit confirm checkboxes support changed values in same save.
- POST /api/tasks/:id/publish {revision,confirmed:true} -> {task}. Needs nonblank title and explicit confirmation; no minimum score.
- POST /api/tasks/:id/proposals {idea,plan,timeline,prototypeUrl} -> {proposal}. Selected team derived from header. Unlimited proposals. Nonblank all fields and valid http(s) URL required.
- POST /api/proposals/:id/decision {status:'selected'|'rejected'} -> {proposal}. Business only, one/multiple/none permitted; no exclusive constraint. Rejecting a proposal with confirmed progress returns 409 (history preserved).
- POST /api/proposals/:id/submit-stage {title,evidenceUrl} -> {proposal}. Selected team only. One minimal stage for MVP; evidenceUrl http(s), title required.
- POST /api/proposals/:id/confirm-stage {} -> {proposal,teams}. Business only; only selected proposal, submitted stage; +10 points once. Repeat is idempotent.
Proposal {id,taskId,teamId,idea,plan,timeline,prototypeUrl,status:'pending'|'selected'|'rejected',createdAt,milestone:null|{title,evidenceUrl,submittedAt,confirmedAt:null|string,points:0|10}}.

## Python module interfaces
`app/domain.py`: FIELD_LABELS dict, INDUSTRIES list; score_task(fields,confirmed_fields) -> score; validate_fields(fields) -> normalized dict or ValueError; valid_url(value)->bool; field_is_meaningful(value)->bool.
`app/seed.py`: seed_data() -> {tasks:[Task],teams:[Team],proposals:[Proposal]}; >=5 each, 5 tasks are published cards, plus 5 draft descriptions as extra draft tasks allowed. Use fixed IDs task1..task5, draft1..draft5, t1..t5, p1..p5. Scores computed by backend, timestamps ISO strings.
`app/agents.py`: AgentOrchestrator(); .mode property; .questions(draft,industry,fields=None) -> {questions,mode,warning,trace}; .compose(draft,industry,answers,fields=None) -> {fields,mode,warning,trace}. Fields always all 10; no fabricated facts. Local fallback explicitly mode='local'. Optional configured remote provider, bounded timeout, strict validation, same local fallback on failures. Trace short summaries of actual steps, never private chain-of-thought.
