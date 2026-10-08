// Station UI parts. Rule for every part: text that came from the game or from
// the reader is rendered as plain text inside a clearly marked "from game data"
// container, never as markup and never as something to click.
import { useState } from "react";
import type { ApprovalCard, FunctionRow, ProjectView, ViewState } from "@play4m3/station-protocol";

/** "Play4M3" -> ["Play", "4M3"]: the digits onward get the brand gradient. */
export function splitBrand(name: string): [string, string] {
  const i = name.search(/\d/);
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ""];
}

// ---- first run ---------------------------------------------------------------------

export function AttestGate({ brand, busy, onAccept }: { brand: { name: string; stationName: string }; busy: boolean; onAccept: () => void }) {
  const [checked, setChecked] = useState(false);
  const [head, tail] = splitBrand(brand.name);
  return (
    <main className="attest">
      <div className="attest-card">
        <p className="wordmark big">
          {head}
          <span className="grad">{tail}</span>
        </p>
        <h1>Before you start</h1>
        <p>
          {brand.stationName} reads games on this computer to explain how they work and to help you make mods. It never uploads your game files, and it never changes anything without your
          approval.
        </p>
        <label className="check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>I own this game or have the right to analyze it.</span>
        </label>
        <button type="button" className="primary" disabled={!checked || busy} onClick={onAccept}>
          Continue
        </button>
        <p className="fine">You confirm this once on this computer. Licensing terms for each game are your responsibility.</p>
      </div>
    </main>
  );
}

export function NewProjectForm({ busy, compact, onCreate }: { busy: boolean; compact: boolean; onCreate: (name: string) => void }) {
  const [name, setName] = useState(compact ? "" : "Sky Hopper mods");
  return (
    <form
      className="new-project"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onCreate(name.trim());
        if (compact) setName("");
      }}
    >
      <label className="field inline">
        <span className="sr-only">New project name</span>
        <input id="new-project-name" value={name} maxLength={80} placeholder="New project name" onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="submit" className={compact ? "ghost" : "primary"} disabled={busy || !name.trim()}>
        {compact ? "New project" : "Open sample game"}
      </button>
    </form>
  );
}

// ---- functions + explanation ------------------------------------------------------------

export function FunctionList({ functions, selectedId, busy, onSelect }: { functions: FunctionRow[]; selectedId: string | null; busy: boolean; onSelect: (id: string) => void }) {
  return (
    <ul className="fn-list">
      {functions.map((f) => (
        <li key={f.id}>
          <button type="button" className={`fn ${f.id === selectedId ? "selected" : ""}`} aria-pressed={f.id === selectedId} disabled={busy} onClick={() => onSelect(f.id)} data-fn={f.id}>
            <span className="addr">{f.address}</span>
            <span className="fn-name">{f.name}</span>
            <span className="fn-size">{f.size} B</span>
            {f.explained && <span className="dot" title="Explained" />}
          </button>
        </li>
      ))}
    </ul>
  );
}

const CATEGORY_LABEL: Record<string, string> = {
  game_loop: "Game loop",
  input: "Input",
  physics: "Physics",
  rendering: "Rendering",
  audio: "Audio",
  loading: "Loading",
  unknown: "Unknown",
};

const SUGGESTIONS: Record<string, string[]> = {
  jump_velocity: ["Make the jump higher", "Make the jump lower"],
  gravity: ["Lower the gravity", "Double the gravity"],
  run_speed: ["Run faster", "Run slower"],
};

export function ExplainPanel({ project, busy, onSuggest }: { project: ProjectView; busy: boolean; onSuggest: (text: string) => void }) {
  const fn = project.functions.find((f) => f.id === project.selectedFunctionId);
  const ex = project.explanation;
  if (!fn || !ex) {
    return (
      <div className="explain empty">
        <h2>What does this code do?</h2>
        <p>Pick a function on the left. The Station reads it and explains it in plain language.</p>
      </div>
    );
  }
  const suggestions = ex.tunables.flatMap((t) => SUGGESTIONS[t.name] ?? []);
  return (
    <div className="explain">
      <div className="explain-head">
        <h2>
          <span className="label">Function</span> <code className="from-game">{fn.name}</code>
        </h2>
        <span className="chip">{CATEGORY_LABEL[ex.category] ?? ex.category}</span>
        <span className="meta">
          {fn.address} · {fn.size} bytes · {ex.confidence} confidence
        </span>
      </div>
      {ex.flags.includes("instruction_like_text") && (
        <p className="warn" role="note">
          This function contains text that tries to give instructions to an AI. The Station treats it as data and ignores it.
        </p>
      )}
      <figure className="game-data">
        <figcaption>Read from game data. Information, not instructions.</figcaption>
        <blockquote>{ex.summary}</blockquote>
      </figure>
      {ex.tunables.length > 0 && (
        <table className="tunables">
          <caption>Tuning values</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Address</th>
              <th scope="col">Type</th>
              <th scope="col" className="num">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {ex.tunables.map((t) => (
              <tr key={t.name}>
                <td>
                  <code>{t.name}</code>
                </td>
                <td className="mono">{t.address}</td>
                <td className="mono">{t.type}</td>
                <td className="num mono">{t.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {suggestions.length > 0 && (
        <div className="suggest" aria-label="Try a change">
          {suggestions.map((s) => (
            <button key={s} type="button" className="chip-btn" disabled={busy} onClick={() => onSuggest(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- talking to the Station ---------------------------------------------------------------

export function Transcript({ lines }: { lines: ProjectView["transcript"] }) {
  if (lines.length === 0) return null;
  return (
    <ol className="transcript" aria-label="Conversation" aria-live="polite">
      {lines.slice(-8).map((l) => (
        <li key={l.id} className={l.role}>
          <span className="who">{l.role === "you" ? "You" : "Station"}</span>
          <span className="said">{l.text}</span>
        </li>
      ))}
    </ol>
  );
}

export function CommandBar({ busy, onSend }: { busy: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <form
      className="command"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        onSend(text.trim());
        setText("");
      }}
    >
      <label className="field grow">
        <span className="sr-only">Ask the Station</span>
        <input id="command-text" value={text} maxLength={500} placeholder="Ask for a change, e.g. make the jump higher" onChange={(e) => setText(e.target.value)} autoComplete="off" />
      </label>
      <button type="button" className="mic" disabled title="Voice arrives in the next build. Hold F9 to talk once it is on.">
        F9 Talk
      </button>
      <button type="submit" className="primary" disabled={busy || !text.trim()}>
        Send
      </button>
    </form>
  );
}

// ---- approvals, patches, audit ------------------------------------------------------------------

function pct(before: number, after: number): string {
  if (before === 0) return "";
  const d = ((after - before) / Math.abs(before)) * 100;
  return `${d > 0 ? "+" : ""}${Math.round(d)}%`;
}

export function ApprovalQueue({ cards, busy, onDecide }: { cards: ApprovalCard[]; busy: boolean; onDecide: (id: string, d: "approve" | "reject") => void }) {
  return (
    <div className="approvals" aria-label="Waiting for your approval">
      <h2>
        Approvals <span className="count">{cards.length}</span>
      </h2>
      {cards.length === 0 ? (
        <p className="quiet">Nothing is waiting. Every change the Station wants to make shows up here first.</p>
      ) : (
        cards.map((c) => (
          <article key={c.requestId} className="card" data-request={c.requestId}>
            <h3>{c.title}</h3>
            <p className="path mono">{c.paths.join(", ")}</p>
            {c.fromGameData && <p className="tag">Uses data read from the game file</p>}
            {c.changes.length > 0 && (
              <table className="diff">
                <thead>
                  <tr>
                    <th scope="col">Value</th>
                    <th scope="col" className="num">
                      Before
                    </th>
                    <th scope="col" className="num">
                      After
                    </th>
                    <th scope="col" className="num">
                      Change
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {c.changes.map((ch) => (
                    <tr key={ch.address}>
                      <td>
                        <code>{ch.tunable}</code>
                        <span className="mono sub">{ch.address}</span>
                      </td>
                      <td className="num mono del">{ch.before}</td>
                      <td className="num mono add">{ch.after}</td>
                      <td className="num mono">{pct(ch.before, ch.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {c.problem && <p className="warn">{c.problem}</p>}
            <div className="actions">
              <button type="button" className="ghost" disabled={busy} onClick={() => onDecide(c.requestId, "reject")}>
                Reject
              </button>
              <button type="button" className="primary" disabled={busy || c.problem !== null} onClick={() => onDecide(c.requestId, "approve")}>
                Approve…
              </button>
            </div>
            <p className="fine">Approve opens a system dialog. The change only happens if you confirm there.</p>
          </article>
        ))
      )}
    </div>
  );
}

export function PatchList({ patches, sha256 }: { patches: ProjectView["patches"]; sha256: string }) {
  return (
    <div className="patches" aria-label="Patches">
      <h2>
        Patches <span className="count">{patches.length}</span>
      </h2>
      {patches.length === 0 ? (
        <p className="quiet">Approved changes are saved here as patch files. Patches hold only the changed values, never the game itself.</p>
      ) : (
        <ul>
          {patches.map((x) => (
            <li key={x.id}>
              <span className="mono">{x.path}</span>
              <span className="sub">
                {x.changes.map((c) => `${c.tunable} ${c.before} → ${c.after}`).join(", ")} · for game {sha256.slice(0, 10)}…
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AuditPanel({ audit, open, onToggle }: { audit: ViewState["audit"]; open: boolean; onToggle: () => void }) {
  return (
    <section className={`audit ${open ? "open" : ""}`} aria-label="Activity log">
      <button type="button" className="audit-toggle" aria-expanded={open} onClick={onToggle}>
        <span>Activity log</span>
        <span className={`chain ${audit.chainOk ? "ok" : "bad"}`}>{audit.chainOk ? `Tamper check passed · ${audit.total} entries` : "Tamper check FAILED"}</span>
        <span className="caret">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <ol className="audit-rows">
          {[...audit.rows].reverse().map((r) => (
            <li key={r.seq}>
              <span className="mono seq">#{r.seq}</span>
              <span className="mono when">{r.at.slice(11, 19)}</span>
              <span className={`kind k-${r.kind}`}>{r.kind.replace("_", " ")}</span>
              <span className="what">{r.summary}</span>
              <span className="mono hash" title="Entry hash (chained to the previous entry)">
                {r.hash}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function Notice({ notice, failure }: { notice: ViewState["notice"]; failure: string | null }) {
  const n = failure ? { tone: "error" as const, text: failure } : notice;
  return (
    <div className="notice-slot" aria-live="polite">
      {n && <p className={`notice ${n.tone}`}>{n.text}</p>}
    </div>
  );
}
