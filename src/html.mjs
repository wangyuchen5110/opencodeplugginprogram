import fs from "node:fs"
import path from "node:path"
import { spawn } from "node:child_process"

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char])
}

const SEVERITY_LABEL = { error: "error", warn: "warn", info: "info" }

/** 生成自包含 HTML 报告（无外部资源，可直接分享/作 CI artifact）。 */
export function renderHtml(audit, { title = "skills-doctor report", now = new Date() } = {}) {
  const summary = audit.summary
  const counts = audit.counts
  const budget = audit.budget
  const ratio = budget > 0 ? Math.min(1.5, summary.advertisedTokens / (budget * 2)) : 0
  const barWidth = Math.min(100, Math.round(ratio * 100))
  const barClass = summary.advertisedTokens > budget * 2 ? "over" : summary.advertisedTokens > budget ? "warn" : "ok"

  const findings = audit.findings
    .map(
      (finding) => `<tr class="finding ${finding.severity}" data-severity="${finding.severity}">
  <td><span class="badge ${finding.severity}">${SEVERITY_LABEL[finding.severity] ?? finding.severity}</span></td>
  <td class="rule">${esc(finding.rule)}</td>
  <td>${esc(finding.message)}</td>
</tr>`,
    )
    .join("\n")

  const skills = audit.skills
    .map(
      (skill) => `<tr class="skill">
  <td class="mono">${esc(skill.id)}</td>
  <td>${esc(skill.source.scope)}</td>
  <td>${skill.advertised ? "yes" : "no"}</td>
  <td class="num">${skill.descriptionTokens}</td>
  <td class="num">${skill.bodyTokens}</td>
  <td class="desc">${esc(String(skill.description ?? "").slice(0, 80))}</td>
  <td class="mono path">${esc(skill.file)}</td>
</tr>`,
    )
    .join("\n")

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light dark; --fg:#1f2328; --muted:#656d76; --bg:#fff; --card:#f6f8fa; --border:#d0d7de; --red:#cf222e; --yellow:#9a6700; --green:#1a7f37; --blue:#0969da; }
  @media (prefers-color-scheme: dark) { :root { --fg:#e6edf3; --muted:#8d96a0; --bg:#0d1117; --card:#161b22; --border:#30363d; --red:#ff7b72; --yellow:#d29922; --green:#3fb950; --blue:#58a6ff; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:32px; font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; color:var(--fg); background:var(--bg); }
  h1 { margin:0 0 4px; font-size:24px; }
  h2 { margin:32px 0 12px; font-size:18px; }
  .sub { color:var(--muted); font-size:12px; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin:20px 0; }
  .card { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:12px 14px; }
  .card .k { color:var(--muted); font-size:12px; }
  .card .v { font-size:22px; font-weight:600; margin-top:2px; }
  .card.error .v { color:var(--red); } .card.warn .v { color:var(--yellow); } .card.info .v { color:var(--blue); }
  .bar { height:10px; border-radius:6px; background:var(--card); border:1px solid var(--border); overflow:hidden; margin:8px 0 4px; }
  .bar > span { display:block; height:100%; width:${barWidth}%; }
  .bar > span.ok { background:var(--green); } .bar > span.warn { background:var(--yellow); } .bar > span.over { background:var(--red); }
  table { width:100%; border-collapse:collapse; background:var(--bg); border:1px solid var(--border); border-radius:10px; overflow:hidden; }
  th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--border); vertical-align:top; }
  th { background:var(--card); font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.03em; }
  tr:last-child td { border-bottom:none; }
  .badge { display:inline-block; padding:1px 8px; border-radius:999px; font-size:11px; font-weight:600; border:1px solid currentColor; }
  .badge.error { color:var(--red); } .badge.warn { color:var(--yellow); } .badge.info { color:var(--blue); }
  .rule { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; white-space:nowrap; }
  .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
  .path { color:var(--muted); word-break:break-all; }
  .num { text-align:right; font-variant-numeric:tabular-nums; }
  .toolbar { display:flex; gap:8px; flex-wrap:wrap; margin:12px 0; }
  .toolbar button, .toolbar input { font:inherit; padding:6px 10px; border-radius:8px; border:1px solid var(--border); background:var(--card); color:var(--fg); }
  .toolbar button.active { border-color:var(--blue); color:var(--blue); }
  .empty { color:var(--muted); padding:16px; }
  footer { margin-top:40px; color:var(--muted); font-size:12px; }
</style>
</head>
<body>
  <h1>${esc(title)}</h1>
  <div class="sub">generated ${esc(now.toISOString())} · ${esc(audit.cwd)}</div>

  <div class="cards">
    <div class="card"><div class="k">definitions</div><div class="v">${summary.total}</div></div>
    <div class="card"><div class="k">unique IDs</div><div class="v">${summary.unique}</div></div>
    <div class="card"><div class="k">advertised</div><div class="v">${summary.advertised}</div></div>
    <div class="card"><div class="k">description tokens / step</div><div class="v">${summary.advertisedTokens}</div></div>
    <div class="card error"><div class="k">errors</div><div class="v">${counts.errors}</div></div>
    <div class="card warn"><div class="k">warnings</div><div class="v">${counts.warnings}</div></div>
    <div class="card info"><div class="k">info</div><div class="v">${counts.infos}</div></div>
  </div>

  <h2>Context budget</h2>
  <div class="bar"><span class="${barClass}"></span></div>
  <div class="sub">${summary.advertisedTokens} tokens vs budget ${budget}${summary.advertisedTokens > budget * 2 ? " (over 2x)" : summary.advertisedTokens > budget ? " (over)" : " (ok)"}</div>

  <h2>Findings (${audit.findings.length})</h2>
  <div class="toolbar">
    <button data-filter="all" class="active">all</button>
    <button data-filter="error">error</button>
    <button data-filter="warn">warn</button>
    <button data-filter="info">info</button>
    <input id="q" placeholder="filter text…" />
  </div>
  <table id="findings">
    <thead><tr><th>severity</th><th>rule</th><th>message</th></tr></thead>
    <tbody>
${findings || '<tr><td colspan="3" class="empty">No problems found.</td></tr>'}
    </tbody>
  </table>

  <h2>Skills (${audit.skills.length})</h2>
  <table>
    <thead><tr><th>ID</th><th>scope</th><th>advertised</th><th>desc tokens</th><th>body tokens</th><th>description</th><th>file</th></tr></thead>
    <tbody>
${skills}
    </tbody>
  </table>

  <footer>skills-doctor · ${esc(audit.version ?? "")} · updates: re-run <code>skills-doctor check --html</code></footer>

<script>
  const buttons = [...document.querySelectorAll("[data-filter]")]
  const q = document.getElementById("q")
  let active = "all"
  function apply() {
    const text = (q.value || "").toLowerCase()
    for (const row of document.querySelectorAll("tr.finding")) {
      const okSeverity = active === "all" || row.dataset.severity === active
      const okText = !text || row.textContent.toLowerCase().includes(text)
      row.style.display = okSeverity && okText ? "" : "none"
    }
  }
  for (const button of buttons) {
    button.addEventListener("click", () => {
      active = button.dataset.filter
      for (const other of buttons) other.classList.toggle("active", other === button)
      apply()
    })
  }
  q.addEventListener("input", apply)
</script>
</body>
</html>
`
}

export function writeHtmlReport(audit, file, options = {}) {
  const target = path.resolve(file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, renderHtml(audit, options), "utf8")
  return target
}

/** 用系统默认程序打开报告；失败时静默（调用方已经知道路径）。 */
export function openReport(file) {
  const target = path.resolve(file)
  try {
    if (process.platform === "win32") spawn("cmd", ["/c", "start", "", target], { detached: true, stdio: "ignore" }).unref()
    else if (process.platform === "darwin") spawn("open", [target], { detached: true, stdio: "ignore" }).unref()
    else spawn("xdg-open", [target], { detached: true, stdio: "ignore" }).unref()
  } catch {}
}
