function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderAdminLogin({ error = "" } = {}) {
  const errorHtml = error
    ? `<div class="error">${escapeHtml(error)}</div>`
    : "";

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VIP Cobros - Acceso</title>
<style>
  body{margin:0;background:#08111f;color:#e8eef8;font-family:Inter,Segoe UI,Arial,sans-serif;display:grid;place-items:center;min-height:100vh}
  .card{width:min(430px,90vw);background:#0f1b2d;border:1px solid #24334b;border-radius:18px;padding:28px;box-shadow:0 24px 70px #0008}
  h1{font-size:24px;margin:0 0 8px}.muted{color:#9fb0c9;margin:0 0 24px}
  label{display:block;font-size:13px;color:#b9c7da;margin-bottom:8px}
  input{width:100%;box-sizing:border-box;background:#08111f;border:1px solid #34445f;border-radius:10px;padding:13px;color:#fff;font-size:15px}
  button{width:100%;margin-top:14px;padding:13px;border:0;border-radius:10px;background:#1f74ff;color:white;font-weight:700;cursor:pointer}
  .error{background:#3d1420;border:1px solid #7b2b40;color:#ffd7df;padding:10px;border-radius:10px;margin-bottom:14px}
</style>
</head>
<body>
  <form class="card" method="post" action="/admin/login" autocomplete="off">
    <h1>VIP COBROS</h1>
    <p class="muted">Consola administrativa segura</p>
    ${errorHtml}
    <label for="key">SERVICE_API_KEY</label>
    <input id="key" name="key" type="password" required autofocus>
    <button type="submit">Ingresar</button>
  </form>
</body>
</html>`;
}

export function renderAdminConsole() {
  return String.raw`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VIP Cobros - Consola Administrativa</title>
<style>
  :root{--bg:#07101d;--panel:#0d1929;--line:#24344f;--text:#eaf1fb;--muted:#9db0c9;--blue:#2d7fff;--green:#36d399;--amber:#ffbd4a;--red:#ff657a}
  *{box-sizing:border-box} body{margin:0;background:linear-gradient(180deg,#07101d,#091524 55%,#07101d);color:var(--text);font-family:Inter,Segoe UI,Arial,sans-serif}
  .wrap{max-width:1500px;margin:auto;padding:20px}.top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px}
  h1{margin:0;font-size:25px}.sub{color:var(--muted);font-size:13px;margin-top:4px}
  .logout{background:#17243a;color:#dbe7f7;border:1px solid var(--line);padding:9px 14px;border-radius:9px;cursor:pointer}
  .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:15px}
  .card{background:rgba(13,25,41,.92);border:1px solid var(--line);border-radius:14px;padding:14px;min-height:82px}
  .label{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em}.value{margin-top:8px;font-weight:700;word-break:break-word}
  .toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:end;background:var(--panel);border:1px solid var(--line);padding:13px;border-radius:14px;margin-bottom:14px}
  .field label{display:block;color:var(--muted);font-size:11px;margin-bottom:5px}.field input{background:#07101d;border:1px solid var(--line);color:#fff;border-radius:8px;padding:10px}
  button.action{border:1px solid #315179;background:#14233a;color:#eaf1fb;padding:10px 13px;border-radius:9px;cursor:pointer;font-weight:650}
  button.action:hover{background:#1a3153}.danger{background:#5e1725!important;border-color:#9a2d44!important}.primary{background:#1557bd!important;border-color:#2d7fff!important}
  .terminal{height:500px;background:#02070d;border:1px solid #21324b;border-radius:14px;padding:14px;overflow:auto;font-family:Consolas,Monaco,monospace;font-size:13px;line-height:1.45;white-space:pre-wrap}
  .cmdrow{display:flex;gap:8px;margin-top:9px}.prompt{background:#02070d;border:1px solid #21324b;border-radius:10px;display:flex;align-items:center;padding-left:12px;flex:1;color:#63e6be;font-family:Consolas,monospace}
  .prompt input{flex:1;background:transparent;border:0;outline:0;color:#fff;padding:12px;font-family:inherit}
  .confirm{display:none;margin-top:14px;background:#311723;border:1px solid #8b3048;padding:16px;border-radius:13px}
  .confirm h3{margin:0 0 8px}.confirm pre{white-space:pre-wrap;color:#ffe4ea}
  .ok{color:var(--green)}.warn{color:var(--amber)}.err{color:var(--red)}
  @media(max-width:1000px){.cards{grid-template-columns:repeat(2,1fr)}} @media(max-width:650px){.cards{grid-template-columns:1fr}.terminal{height:430px}}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div><h1>VIP COBROS – CONSOLA ADMINISTRATIVA</h1><div class="sub">Solo comandos controlados del proyecto. No existe acceso a terminal del sistema.</div></div>
    <form method="post" action="/admin/logout"><button class="logout">Cerrar sesión</button></form>
  </div>

  <div class="cards">
    <div class="card"><div class="label">Estado servicio</div><div class="value" id="svc">...</div></div>
    <div class="card"><div class="label">Versión / commit</div><div class="value" id="ver">...</div></div>
    <div class="card"><div class="label">Scheduler</div><div class="value" id="sch">...</div></div>
    <div class="card"><div class="label">Zona horaria</div><div class="value" id="tz">...</div></div>
    <div class="card"><div class="label">Última sincronización</div><div class="value" id="sync">...</div></div>
    <div class="card"><div class="label">Último proceso de cobro</div><div class="value" id="cobro">...</div></div>
    <div class="card"><div class="label">Último error</div><div class="value" id="error">...</div></div>
    <div class="card"><div class="label">Proceso activo</div><div class="value" id="running">...</div></div>
  </div>

  <div class="toolbar">
    <div class="field"><label>Fecha desde</label><input id="desde" type="date" value="2026-01-01"></div>
    <button class="action" onclick="runCommand('estado')">Estado</button>
    <button class="action" onclick="runCommand('consultar-cartera --desde='+desde())">Consultar cartera</button>
    <button class="action primary" onclick="runCommand('previsualizar-cobro --desde='+desde())">Previsualizar cobros</button>
    <button class="action danger" onclick="runCommand('iniciar-cobro --desde='+desde()+' --modo=real')">Iniciar envío real</button>
    <button class="action" onclick="runCommand('ver-historial')">Ver historial</button>
    <button class="action" onclick="runCommand('ver-logs')">Ver logs</button>
  </div>

  <div id="terminal" class="terminal">VIP COBROS &gt; Consola lista.\n</div>
  <div class="cmdrow">
    <div class="prompt">VIP COBROS &gt;<input id="command" placeholder="previsualizar-cobro --desde=2026-01-01"></div>
    <button class="action" onclick="submitCommand()">Ejecutar</button>
  </div>

  <div id="confirm" class="confirm">
    <h3>CONFIRMACIÓN DE ENVÍO REAL</h3>
    <pre id="confirmSummary"></pre>
    <button class="action danger" onclick="confirmReal()">CONFIRMAR ENVÍO</button>
    <button class="action" onclick="cancelReal()">CANCELAR</button>
  </div>
</div>

<script>
let lastLogStamp = "";
let pendingConfirmation = null;
const terminal = document.getElementById("terminal");

function desde(){ return document.getElementById("desde").value || "2026-01-01"; }
function append(text, cls=""){
  const line=document.createElement("div"); if(cls) line.className=cls;
  line.textContent=String(text); terminal.appendChild(line); terminal.scrollTop=terminal.scrollHeight;
}
function money(v){ return new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0}).format(Number(v||0)); }

async function api(path, options={}){
  const r=await fetch(path,{credentials:"same-origin",headers:{"content-type":"application/json",...(options.headers||{})},...options});
  const text=await r.text(); let data; try{data=JSON.parse(text)}catch{data={ok:false,error:text}}
  if(!r.ok || data.ok===false) throw new Error(data.error||("HTTP "+r.status));
  return data;
}

async function refreshStatus(){
  try{
    const d=await api("/api/status");
    document.getElementById("svc").textContent=d.ok?"ONLINE":"ERROR";
    document.getElementById("ver").textContent=(d.version||"-")+" / "+(d.commit||"-");
    document.getElementById("sch").textContent=(d.scheduler?.enabled?"ACTIVO ":"INACTIVO ")+(String(d.scheduler?.hour??"").padStart(2,"0"))+":"+(String(d.scheduler?.minute??"").padStart(2,"0"));
    document.getElementById("tz").textContent=d.timezone||"-";
    document.getElementById("sync").textContent=d.lastDailySuccessDate||"-";
    document.getElementById("cobro").textContent=d.lastCobro?.finishedAt||d.lastCobro?.startedAt||"-";
    document.getElementById("error").textContent=d.lastError?.message||d.lastCobroError?.message||"-";
    document.getElementById("running").textContent=d.running?d.running.kind:"NINGUNO";
  }catch(e){document.getElementById("svc").textContent="SIN RESPUESTA";}
}

async function refreshLogs(){
  try{
    const d=await api("/api/logs?limit=80");
    const logs=d.logs||[];
    for(const item of logs){
      const stamp=item.at+"|"+item.level+"|"+item.message;
      if(lastLogStamp && stamp<=lastLogStamp) continue;
      append("["+item.at+"] ["+item.level+"] "+item.message+(item.data?" "+JSON.stringify(item.data):""),item.level==="ERROR"?"err":item.level==="WARN"?"warn":"");
      lastLogStamp=stamp;
    }
  }catch{}
}

function prettyPlan(data){
  const s=data.plan?.summary||data.summary||{};
  let out="-----------------------------------------\nPREVISUALIZACIÓN DE COBRO\n-----------------------------------------\n";
  out+="Periodo: "+(s.desde||"-")+" - "+(s.hasta||"-")+"\n";
  out+="Filtro Biofile: "+(s.filtroBiofile||"CON DEUDA")+"\n";
  out+="Facturas con saldo: "+(s.facturasConSaldo??0)+"\n";
  out+="Empresas: "+(s.empresas??0)+"\n";
  out+="Saldo total: "+money(s.saldoTotal)+"\n";
  out+="Empresas con envío hoy: "+(s.empresasConEnvio??0)+"\n";
  out+="Facturas con envío hoy: "+(s.facturasConEnvio??0)+"\n";
  out+="Saldo incluido en envío: "+money(s.saldoAEnviar)+"\n";
  const groups=data.plan?.groups||[];
  for(const g of groups){
    out+="\n-----------------------------------------\n"+g.cliente+"\n";
    out+="Saldo pendiente empresa: "+money(g.saldoTotalEmpresa)+"\n";
    out+="Nivel correspondiente: "+(g.nivel===null?"NO TOCA HOY":"NIVEL "+g.nivel)+"\n";
    out+="Destinatario: "+(g.correo||"NO ENCONTRADO")+"\n";
    out+="Acción: "+g.accion+"\n";
    for(const f of (g.facturas||[])){
      out+="  "+f.nFactura+" | "+money(f.saldo)+" | mora "+f.diasMora+" días | "+(f.nivel===null?"sin nivel":"nivel "+f.nivel)+" | "+f.accion+"\n";
    }
  }
  return out;
}

async function runCommand(command){
  append("VIP COBROS > "+command,"ok");
  try{
    const d=await api("/api/admin/command",{method:"POST",body:JSON.stringify({command})});
    if(d.type==="preview"||d.type==="consultar"){ append(prettyPlan(d)); }
    else if(d.type==="prepare-real"){
      append(prettyPlan(d));
      pendingConfirmation=d.confirmationId;
      document.getElementById("confirmSummary").textContent=
        "Periodo: "+d.plan.summary.desde+" - "+d.plan.summary.hasta+"\n"+
        "Filtro: CON DEUDA\n"+
        d.plan.summary.empresasConEnvio+" empresas\n"+
        d.plan.summary.facturasConEnvio+" facturas\n"+
        money(d.plan.summary.saldoAEnviar)+" de cartera incluida\n\nESTÁ A PUNTO DE INICIAR EL ENVÍO REAL";
      document.getElementById("confirm").style.display="block";
    } else append(JSON.stringify(d,null,2));
  }catch(e){append("ERROR: "+e.message,"err");}
  refreshStatus();
}

function submitCommand(){
  const input=document.getElementById("command"); const cmd=input.value.trim();
  if(!cmd)return; input.value=""; runCommand(cmd);
}

document.getElementById("command").addEventListener("keydown",e=>{if(e.key==="Enter")submitCommand()});

async function confirmReal(){
  if(!pendingConfirmation)return;
  append("VIP COBROS > CONFIRMAR ENVÍO REAL","warn");
  try{
    const d=await api("/api/cobro/confirm-real",{method:"POST",body:JSON.stringify({confirmationId:pendingConfirmation})});
    append(JSON.stringify(d,null,2),"ok");
    pendingConfirmation=null;
    document.getElementById("confirm").style.display="none";
  }catch(e){append("ERROR: "+e.message,"err");}
  refreshStatus();
}
function cancelReal(){ pendingConfirmation=null; document.getElementById("confirm").style.display="none"; append("ENVÍO REAL CANCELADO","warn"); }

refreshStatus(); refreshLogs();
setInterval(refreshStatus,5000); setInterval(refreshLogs,1800);
</script>
</body>
</html>`;
}
