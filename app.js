const MODEL_DEFAULT = "https://teachablemachine.withgoogle.com/models/f6c4OmRFMQ/";
const WIDTH = 360, HEIGHT = 360, FLIP = true;
const STORAGE = "genify_data_v1";

let tmModel = null;
let webcam = null;

let state = {
  settings: { modelUrl: MODEL_DEFAULT, threshold: 0.95, cooldown: 15, autoMark: true },
  classes: { "Default Class": ["Alice", "Bob", "Carol"] },
  records: {},
  logs: []
};

const lastMarked = {};

const $ = id => document.getElementById(id);

function toast(msg, t=1600){
  const el = $('toast'); el.textContent = msg; el.classList.remove('hidden'); setTimeout(()=>el.classList.add('hidden'), t);
}

function saveState(){ localStorage.setItem(STORAGE, JSON.stringify(state)); }
function loadState(){ const raw = localStorage.getItem(STORAGE); if(raw) state = JSON.parse(raw); else saveState(); }

window.addEventListener('load', async () => {
  loadState();
  wireUI();
  applyStateToUI();
  renderHome();
  renderClasses();
  tryLoadModel();
});

function wireUI(){
  document.querySelectorAll('.nav-item').forEach(b => b.addEventListener('click', e => showView(e.target.dataset.view)));
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', e => showView(e.currentTarget.dataset.go)));
  $('snap-btn')?.addEventListener('click', onSnapshot);
  $('undo-btn')?.addEventListener('click', onUndo);
  $('export-btn')?.addEventListener('click', ()=> exportCSV(todayKey()));
  $('take-snap')?.addEventListener('click', onSnapshot);
  $('take-undo')?.addEventListener('click', onUndo);
  $('take-save')?.addEventListener('click', onSave);
  $('threshold').addEventListener('input', e => { $('threshold-label').textContent = e.target.value + '%'; state.settings.threshold = e.target.value/100; saveState(); });
  $('cooldown').addEventListener('input', e => { $('cooldown-label').textContent = e.target.value; state.settings.cooldown = parseInt(e.target.value); saveState(); });

  $('add-student').addEventListener('click', addStudent);
  $('clear-class').addEventListener('click', clearClassRecords);

  $('records-date').value = todayKey();
  $('records-date').addEventListener('change', renderRecordsTable);
  $('records-class').addEventListener('change', renderRecordsTable);
  $('records-search').addEventListener('input', renderRecordsTable);
  $('records-export').addEventListener('click', ()=> exportCSV($('records-date').value || todayKey()));

  $('add-class').addEventListener('click', addClass);
  $('load-model').addEventListener('click', ()=> { const v = $('model-url').value.trim(); if(v) { state.settings.modelUrl = v; saveState(); tryLoadModel(); }});
  $('reset-all').addEventListener('click', ()=> { if(confirm('Reset local data?')) { localStorage.removeItem(STORAGE); location.reload(); }});

  document.querySelectorAll('.nav-item').forEach(b => b.addEventListener('mouseenter', ()=> b.classList.add('hover')) );
  document.querySelectorAll('.nav-item').forEach(b => b.addEventListener('mouseleave', ()=> b.classList.remove('hover')) );

  document.querySelectorAll('.tile').forEach(t => t.addEventListener('click', e => showView(e.currentTarget.dataset.go)));
}

function showView(view){
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  const node = $(`view-${view}`);
  if(node) node.classList.remove('hidden');
  if(view === 'take') ensureWebcam();
  if(view === 'records') renderRecordsTable();
  if(view === 'students') { renderClasses(); renderStudentsTable(); }
}

function applyStateToUI(){
  $('model-url').value = state.settings.modelUrl;
  $('threshold').value = Math.round((state.settings.threshold||0.95)*100);
  $('threshold-label').textContent = $('threshold').value + '%';
  $('cooldown').value = state.settings.cooldown || 15;
  $('cooldown-label').textContent = $('cooldown').value;
}

function renderHome(){
  const quick = $('quick-tiles');
  quick.innerHTML = '';
  const items = [
    {t:'Take Attendance', go:'take', img:'https://source.unsplash.com/480x300/?classroom'},
    {t:'Manage Students', go:'students', img:'https://source.unsplash.com/480x300/?students'},
    {t:'View Records', go:'records', img:'https://source.unsplash.com/480x300/?data'},
    {t:'Settings', go:'settings', img:'https://source.unsplash.com/480x300/?settings'}
  ];
  items.forEach(it => {
    const div = document.createElement('div'); div.className='tile'; div.dataset.go=it.go;
    div.innerHTML = `<img src="${it.img}"><div>${it.t}</div>`;
    div.addEventListener('click', ()=> showView(it.go));
    quick.appendChild(div);
  });
}

function renderClasses(){
  const arr = Object.keys(state.classes);
  fillSelect($('take-class'), arr);
  fillSelect($('roster-class'), arr);
  fillSelect($('records-class'), arr);
  fillSelect($('class-select'), arr);
  // classes row for students page
  const row = $('classes-row'); if(row){ row.innerHTML = ''; arr.forEach(c=>{
    const pill = document.createElement('div'); pill.className='class-pill'; pill.textContent = c;
    pill.addEventListener('click', ()=> { document.querySelectorAll('.class-pill').forEach(p=>p.classList.remove('active')); pill.classList.add('active'); renderStudentsTable(c); });
    row.appendChild(pill);
  });}
  renderTakeRoster();
  renderStudentsTable();
  renderRecordsTable();
}

function fillSelect(el, arr){
  if(!el) return; el.innerHTML=''; arr.forEach(a=> { const o=document.createElement('option'); o.value=a; o.textContent=a; el.appendChild(o); });
}

function renderTakeRoster(){
  const cls = $('take-class').value || Object.keys(state.classes)[0];
  $('roster-class').value = cls;
  const roster = state.classes[cls] || [];
  const list = $('roster-list'); list.innerHTML = '';
  const date = todayKey();
  roster.forEach(name => {
    const rec = state.records[date] && state.records[date][cls] && state.records[date][cls][name];
    const div = document.createElement('div'); div.className='student-row';
    div.innerHTML = `<div class="name">${escape(name)}</div><div class="status">${rec? '<span class="present">Present</span>':'<span class="absent">Absent</span>'}</div>`;
    list.appendChild(div);
  });
}

function addStudent(){
  const name = ($('new-student').value || '').trim();
  const cls = $('roster-class').value || Object.keys(state.classes)[0];
  if(!name) return toast('Enter a name');
  if(!state.classes[cls]) state.classes[cls]=[];
  state.classes[cls].push(name);
  $('new-student').value='';
  saveState(); renderClasses(); toast('Student added');
}

function clearClassRecords(){
  const cls = $('roster-class').value || Object.keys(state.classes)[0];
  const date = todayKey();
  if(state.records[date] && state.records[date][cls]) delete state.records[date][cls];
  saveState(); renderTakeRoster(); renderRecordsTable(); toast('Cleared records for today');
}

function renderStudentsTable(filterClass){
  const tbody = document.querySelector('#students-table tbody'); tbody.innerHTML='';
  Object.keys(state.classes).forEach(cls => {
    state.classes[cls].forEach(name => {
      const tr = document.createElement('tr'); tr.innerHTML = `<td>${escape(name)}</td><td>${escape(cls)}</td><td><button class="btn remove">Remove</button></td>`;
      const btn = tr.querySelector('button'); btn.addEventListener('click', ()=> {
        state.classes[cls] = state.classes[cls].filter(n=>n!==name); saveState(); renderStudentsTable(); renderClasses(); toast('Removed');
      });
      tbody.appendChild(tr);
    });
  });
}

function renderRecordsTable(){
  const date = $('records-date').value || todayKey();
  const cls = $('records-class').value || Object.keys(state.classes)[0];
  const search = ($('records-search').value || '').toLowerCase();
  const tbody = document.querySelector('#records-table tbody'); tbody.innerHTML = '';
  const roster = state.classes[cls] || [];
  roster.forEach(name => {
    if(search && !name.toLowerCase().includes(search)) return;
    const rec = state.records[date] && state.records[date][cls] && state.records[date][cls][name];
    const present = rec ? '✅' : '❌';
    const time = rec ? new Date(rec.ts*1000).toLocaleTimeString() : '-';
    const tr = document.createElement('tr'); tr.innerHTML = `<td>${escape(name)}</td><td>${present}</td><td>${time}</td>`;
    tbody.appendChild(tr);
  });
}

function tryLoadModel(){
  const url = state.settings.modelUrl || MODEL_DEFAULT;
  tmImage.load(url + 'model.json', url + 'metadata.json').then(m => { tmModel = m; toast('Model loaded'); }).catch(e=>{ console.warn(e); toast('Model load failed'); });
}

function ensureWebcam(){
  if(webcam) return;
  webcam = new tmImage.Webcam(WIDTH, HEIGHT, FLIP);
  webcam.setup().then(()=> webcam.play().then(()=> {
    const wrap = $('webcam-wrap'); wrap.innerHTML=''; wrap.appendChild(webcam.canvas);
    requestAnimationFrame(loop);
  })).catch(e=>{ console.warn(e); toast('Camera access denied'); });
}

async function loop(){
  if(!webcam || !tmModel){ requestAnimationFrame(loop); return; }
  webcam.update();
  const preds = await tmModel.predict(webcam.canvas);
  if(preds && preds.length){
    let best = preds[0]; preds.forEach(p=> { if(p.probability > best.probability) best = p; });
    updateLive(best);
    autoMarkIfNeeded(best);
  }
  requestAnimationFrame(loop);
}

function updateLive(best){
  const pct = Math.round(best.probability*100);
  $('live-status').textContent = `${best.className} — ${pct}%`;
  $('global-bar').style.width = pct + '%';
  $('global-pct').textContent = pct + '%';
  const thresh = state.settings.threshold || 0.95;
  if(best.probability >= thresh){ $('global-bar').style.background = '#00ff88'; $('live-status').style.color = '#00ff88'; }
  else if(best.probability >= 0.5){ $('global-bar').style.background = '#ffeb3b'; $('live-status').style.color = '#ffeb3b'; }
  else { $('global-bar').style.background = '#ff6b6b'; $('live-status').style.color = '#ff6b6b'; }
}

function autoMarkIfNeeded(best){
  if(!state.settings.autoMark) return;
  const name = best.className;
  const prob = best.probability;
  const thresh = state.settings.threshold || 0.95;
  const cd = state.settings.cooldown || 15;
  const now = Math.floor(Date.now()/1000);
  const last = lastMarked[name] || 0;
  if(prob >= thresh && (now - last) >= cd){
    const cls = $('take-class').value || Object.keys(state.classes)[0];
    const date = todayKey();
    if(!state.records[date]) state.records[date] = {};
    if(!state.records[date][cls]) state.records[date][cls] = {};
    state.records[date][cls][name] = { present: true, ts: now };
    lastMarked[name] = now;
    state.logs.push(`[${new Date().toLocaleTimeString()}] Auto-marked ${name}`);
    saveState(); renderTakeRoster(); renderRecordsTable(); toast(`${name} marked`);
  }
}

function renderTakeRoster(){ const cls = $('take-class').value || Object.keys(state.classes)[0]; const roster = state.classes[cls] || []; const out = $('roster-list'); out.innerHTML=''; const date=todayKey(); roster.forEach(name=>{ const rec = state.records[date] && state.records[date][cls] && state.records[date][cls][name]; const div=document.createElement('div'); div.className='student-row'; div.innerHTML=`<div class="name">${escape(name)}</div><div class="status">${rec?'<span class="present">Present</span>':'<span class="absent">Absent</span>'}</div>`; out.appendChild(div); }); }

function onSnapshot(){ if(!webcam) return toast('Camera not ready'); const dataUrl = webcam.canvas.toDataURL('image/png'); fetch(dataUrl).then(r=>r.blob()).then(blob=>{ saveAs(blob, `genify_snap_${Date.now()}.png`); toast('Snapshot saved'); }); }

function onUndo(){ let last={ts:0,date:null,cls:null,name:null}; Object.keys(state.records).forEach(d=>{ Object.keys(state.records[d]).forEach(c=>{ Object.keys(state.records[d][c]).forEach(n=>{ const r=state.records[d][c][n]; if(r.ts>last.ts){ last={ts:r.ts,date:d,cls:c,name:n}; } }); }); }); if(!last.name) return toast('Nothing to undo'); delete state.records[last.date][last.cls][last.name]; saveState(); renderRecordsTable(); renderTakeRoster(); toast('Undo done'); }

function onSave(){ saveState(); toast('Saved'); }

function addClass(){ const name = ($('class-name').value||'').trim(); if(!name) return toast('Enter class name'); if(state.classes[name]) return toast('Class exists'); state.classes[name]=[]; $('class-name').value=''; saveState(); renderClasses(); toast('Class added'); }

function exportCSV(dateKey){ const groups = state.records[dateKey] || {}; let csv="Class,Name,Present,Timestamp\n"; Object.keys(groups).forEach(g=>{ Object.keys(groups[g]).forEach(n=>{ const r=groups[g][n]; csv+=`${csvEscape(g)},${csvEscape(n)},Yes,${r.ts?new Date(r.ts*1000).toISOString():''}\n`; }); }); const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}); saveAs(blob, `genify_${dateKey}.csv`); toast('Exported'); }

function onImportCSV(e){ const f=e.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=evt=>{ const txt=evt.target.result.trim(); const lines=txt.split(/\r?\n/); lines.slice(1).forEach(l=>{ const cols=l.split(','); const cls = cols[0].replace(/^"|"$/g,''); const name = cols[1].replace(/^"|"$/g,''); const present = (cols[2]||'Yes').toLowerCase().startsWith('y'); const ts = cols[3] ? Date.parse(cols[3]) : Date.now(); const date = new Date(ts).toISOString().slice(0,10); if(!state.classes[cls]) state.classes[cls]=[]; if(!state.classes[cls].includes(name)) state.classes[cls].push(name); if(present){ if(!state.records[date]) state.records[date] = {}; if(!state.records[date][cls]) state.records[date][cls] = {}; state.records[date][cls][name] = { present:true, ts: Math.floor(ts/1000) }; } }); saveState(); renderClasses(); toast('Imported'); }; r.readAsText(f); }

function todayKey(){ return new Date().toISOString().slice(0,10); }
function escape(s){ return (''+s).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }
function csvEscape(s){ if(!s) return ''; s=''+s; return s.includes(',')||s.includes('"')? `"${s.replace(/"/g,'""')}"` : s; }

loadState();
applyStateToUI();

function applyStateToUI(){ $('take-class') && fillSelect($('take-class'), Object.keys(state.classes)); $('roster-class') && fillSelect($('roster-class'), Object.keys(state.classes)); $('records-class') && fillSelect($('records-class'), Object.keys(state.classes)); $('model-url') && ($('model-url').value = state.settings.modelUrl); renderTakeRoster(); renderClasses(); renderRecordsTable(); }

function fillSelect(el, arr){ if(!el) return; el.innerHTML=''; arr.forEach(a=>{ const o=document.createElement('option'); o.value=a; o.textContent=a; el.appendChild(o); }); }
