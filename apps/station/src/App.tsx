// The Creation Station shell. Holds the last ViewState from the main process
// and re-renders from it; never keeps its own copy of anything that matters.
import { useCallback, useEffect, useState } from "react";
import type { StationApi, ViewState } from "@play4m3/station-protocol";
import { ApprovalQueue, AttestGate, AuditPanel, CommandBar, ExplainPanel, FunctionList, NewProjectForm, Notice, PatchList, Transcript, splitBrand } from "./parts.js";

interface Props {
  api: StationApi;
  brand: { name: string; stationName: string };
}

export function App({ api, brand }: Props) {
  const [view, setView] = useState<ViewState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);

  const run = useCallback(async (call: () => Promise<ViewState>) => {
    setBusy(true);
    setFailure(null);
    try {
      setView(await call());
    } catch {
      setFailure("The Station did not answer. Try again; if it keeps happening, restart the app.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void run(() => api.state());
  }, [api, run]);

  if (!view) {
    return (
      <div className="boot" data-station-root="booting">
        {failure ?? "Opening the Station…"}
      </div>
    );
  }

  if (!view.attested) {
    return (
      <div className="shell center-screen" data-station-root="attest">
        <AttestGate brand={brand} busy={busy} onAccept={() => void run(() => api.attest())} />
      </div>
    );
  }

  const p = view.project;
  const [head, tail] = splitBrand(brand.name);
  return (
    <div className="shell" data-station-root="workspace">
      <header className="top">
        <div className="brand">
          <span className="wordmark">
            {head}
            <span className="grad">{tail}</span>
          </span>
          <span className="station-name">{brand.stationName}</span>
        </div>
        <div className="project-bar">
          {view.projects.length > 0 && (
            <label className="field inline">
              <span className="sr-only">Project</span>
              <select value={p?.id ?? ""} disabled={busy} onChange={(e) => void run(() => api.selectProject(e.target.value))}>
                {view.projects.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <NewProjectForm key={view.projects.length > 0 ? "compact" : "first"} busy={busy} compact={view.projects.length > 0} onCreate={(name) => void run(() => api.createProject(name))} />
        </div>
        <span className="demo-badge" title="Analysis, reader and planner are stand-ins until the real engines are connected.">
          Demo data
        </span>
      </header>

      <Notice notice={view.notice} failure={failure} />

      {!p ? (
        <main className="empty-state">
          <h1>Start a project</h1>
          <p>A project holds one game you own, what the Station learns about it, and the mods you make. This build opens a small sample game so you can try the whole flow.</p>
        </main>
      ) : (
        <main className="workspace">
          <section className="col functions" aria-label="Functions">
            <div className="col-head">
              <h2>Functions</h2>
              <span className="meta">
                {p.game.title} · {(p.game.sizeBytes / 1024).toFixed(1)} KB
              </span>
            </div>
            <FunctionList functions={p.functions} selectedId={p.selectedFunctionId} busy={busy} onSelect={(id) => void run(() => api.selectFunction(id))} />
          </section>

          <section className="col center" aria-label="Explain and command">
            <div className="center-scroll">
              <ExplainPanel project={p} onSuggest={(text) => void run(() => api.command(text))} busy={busy} />
              <Transcript lines={p.transcript} />
            </div>
            <CommandBar busy={busy} onSend={(text) => void run(() => api.command(text))} />
          </section>

          <section className="col side" aria-label="Approvals and patches">
            <ApprovalQueue cards={p.approvals} busy={busy} onDecide={(id, d) => void run(() => api.decide(id, d))} />
            <PatchList patches={p.patches} sha256={p.game.sha256} />
          </section>
        </main>
      )}

      <AuditPanel audit={view.audit} open={auditOpen} onToggle={() => setAuditOpen((o) => !o)} />
    </div>
  );
}
