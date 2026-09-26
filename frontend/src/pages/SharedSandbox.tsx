import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { editor } from "monaco-editor";
import { MonacoBinding } from "y-monaco";
import type { WebContainer } from "@webcontainer/api";
import FileExplorer from "../components/FileExplorer";
import Terminal from "../components/Terminal";
import { loadSandbox } from "../services/sandbox-api";
import { SandboxFile, initWebContainer, mountFiles, runCommand } from "../services/webcontainer";
import {
  CollabConnection,
  CollabRun,
  connectCollab,
  createCollabSession,
  getOwnerToken,
  kickCollabParticipants,
  rotateCollabToken,
} from "../services/session";
import "../styles/Sandbox.css";

interface Participant {
  clientId: number;
  name: string;
  color: string;
}

const NAME_KEY = "soroban_collab_name";

function collabUserName(): string {
  try {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) return saved;
    const name = `Guest-${Math.floor(Math.random() * 10000)}`;
    localStorage.setItem(NAME_KEY, name);
    return name;
  } catch {
    return "Guest";
  }
}

function shareLink(sandboxId: string, sessionId: string, token: string, role: "edit" | "view"): string {
  return `${window.location.origin}/sandbox/${sandboxId}?session=${sessionId}&token=${token}&role=${role}`;
}

function languageFor(path: string): string {
  if (path.endsWith(".rs")) return "rust";
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  if (path.endsWith(".js")) return "javascript";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".toml")) return "ini";
  return "plaintext";
}

function runToLines(run: CollabRun): string[] {
  const status = run.exitCode === null ? "running…" : `exit ${run.exitCode}`;
  return [`[${run.by}] $ ${run.command} (${status})`, ...run.output.map((l) => `[${run.by}] ${l}`)];
}

/** Live collaborative editor bound to a shared Yjs session (#926). */
const LiveSession: React.FC<{
  sandboxId: string;
  sessionId: string;
  token: string;
  readOnly: boolean;
  initialFiles: Record<string, SandboxFile>;
}> = ({ sandboxId, sessionId, token, readOnly, initialFiles }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const connRef = useRef<CollabConnection | null>(null);
  const webcontainerRef = useRef<WebContainer | null>(null);
  const [status, setStatus] = useState("connecting");
  const [paths, setPaths] = useState<string[]>([]);
  const [tab, setTab] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [runs, setRuns] = useState<CollabRun[]>([]);
  const [running, setRunning] = useState(false);
  const [links, setLinks] = useState<{ edit?: string; view?: string }>({});
  const ownerToken = getOwnerToken(sessionId);
  const isOwner = ownerToken === token;

  useEffect(() => {
    const conn = connectCollab(sessionId, token, { name: collabUserName() }, readOnly ? null : initialFiles);
    connRef.current = conn;
    const { provider, files, meta } = conn;

    const syncFiles = () => setPaths(Array.from(files.keys()).sort());
    const syncTab = () => setTab(meta.get("tab") || null);
    const syncRuns = () => setRuns(conn.runs.toArray());
    const syncPresence = () => {
      const list: Participant[] = [];
      provider.awareness.getStates().forEach((state, clientId) => {
        if (state.user) list.push({ clientId, name: state.user.name, color: state.user.color });
      });
      setParticipants(list);
    };
    const onStatus = ({ status: s }: { status: string }) => setStatus(s);

    files.observe(syncFiles);
    meta.observe(syncTab);
    conn.runs.observe(syncRuns);
    provider.awareness.on("change", syncPresence);
    provider.on("status", onStatus);
    syncFiles();
    syncTab();
    syncRuns();
    syncPresence();

    return () => {
      provider.off("status", onStatus);
      provider.awareness.off("change", syncPresence);
      conn.destroy();
      connRef.current = null;
    };
  }, [sessionId, token, readOnly, initialFiles]);

  // Bind the Monaco model for the shared open tab to its Y.Text.
  useEffect(() => {
    const conn = connRef.current;
    const ytext = tab ? conn?.files.get(tab) : undefined;
    if (!conn || !containerRef.current || !tab || !ytext) return;
    if (!editorRef.current) {
      editorRef.current = editor.create(containerRef.current, { theme: "vs-dark", automaticLayout: true });
    }
    editorRef.current.updateOptions({ readOnly });
    const model = editor.createModel("", languageFor(tab));
    editorRef.current.setModel(model);
    // The local monaco-editor type shim (env.d.ts) is narrower than y-monaco's types.
    type BindingArgs = ConstructorParameters<typeof MonacoBinding>;
    const binding = new MonacoBinding(
      ytext,
      model as unknown as BindingArgs[1],
      new Set([editorRef.current]) as unknown as BindingArgs[2],
      conn.provider.awareness,
    );
    return () => {
      binding.destroy();
      model.dispose();
    };
  }, [tab, paths, readOnly]);

  useEffect(() => () => editorRef.current?.dispose(), []);

  // Remote cursor / selection colours for y-monaco's per-client classes.
  const presenceCss = participants
    .map(
      (p) =>
        `.yRemoteSelection-${p.clientId}{background-color:${p.color}55}` +
        `.yRemoteSelectionHead-${p.clientId}{position:absolute;border-left:2px solid ${p.color};height:100%}`,
    )
    .join("");

  const selectTab = (path: string) => connRef.current?.meta.set("tab", path);

  const run = useCallback(async () => {
    const conn = connRef.current;
    if (!conn || running) return;
    setRunning(true);
    const output: string[] = [];
    const me = conn.provider.awareness.getLocalState()?.user ?? { name: "?", color: "#888" };
    try {
      webcontainerRef.current ??= await initWebContainer();
      const current = new Map<string, SandboxFile>();
      conn.files.forEach((text, path) => current.set(path, { path, content: text.toString(), language: languageFor(path) }));
      await mountFiles(webcontainerRef.current, current);
      const collect = (line: string) => output.push(line);
      let exitCode = await runCommand(webcontainerRef.current, "npm install", collect);
      if (exitCode === 0) exitCode = await runCommand(webcontainerRef.current, "npm start", collect);
      conn.runs.push([{ by: me.name, color: me.color, command: "npm install && npm start", output, exitCode, at: Date.now() }]);
    } catch (err) {
      output.push(err instanceof Error ? err.message : String(err));
      conn.runs.push([{ by: me.name, color: me.color, command: "npm start", output, exitCode: -1, at: Date.now() }]);
    } finally {
      setRunning(false);
    }
  }, [running]);

  const rotate = async (role: "edit" | "view") => {
    if (!ownerToken) return;
    const { token: fresh } = await rotateCollabToken(sessionId, ownerToken, role);
    setLinks((l) => ({ ...l, [role]: shareLink(sandboxId, sessionId, fresh, role) }));
  };

  const fileList: SandboxFile[] = paths.map((path) => ({ path, content: "", language: languageFor(path) }));

  return (
    <div className="sandbox-container">
      <style>{presenceCss}</style>
      <div className="sandbox-header">
        <h1>Soroban Sandbox - Live Session{readOnly ? " (view only)" : ""}</h1>
        <span data-testid="collab-status" style={{ fontSize: "12px", color: status === "connected" ? "#98c379" : "#e5c07b" }}>
          {status}
        </span>
        {!readOnly && (
          <button onClick={run} disabled={running}>
            {running ? "Running…" : "Run"}
          </button>
        )}
      </div>

      <div className="sandbox-layout">
        <FileExplorer files={fileList} selectedFile={tab} onSelectFile={selectTab} />

        <div className="editor-section">
          <div ref={containerRef} data-testid="collab-editor" style={{ width: "100%", height: "100%" }} />
        </div>

        <div className="right-panel">
          <div className="preview">
            <div className="preview-header">Participants</div>
            <div className="preview-content" data-testid="collab-participants">
              {participants.map((p) => (
                <div key={p.clientId} style={{ fontSize: "12px", color: p.color }}>
                  ● {p.name}
                </div>
              ))}
              {isOwner && (
                <div style={{ marginTop: "8px", fontSize: "12px" }}>
                  <button onClick={() => rotate("edit")}>New edit link</button>{" "}
                  <button onClick={() => rotate("view")}>New view link</button>{" "}
                  <button onClick={() => ownerToken && kickCollabParticipants(sessionId, ownerToken)}>Kick all</button>
                  {links.edit && <p style={{ wordBreak: "break-all" }}>Edit: {links.edit}</p>}
                  {links.view && <p style={{ wordBreak: "break-all" }}>View: {links.view}</p>}
                </div>
              )}
            </div>
          </div>
          <Terminal output={runs.length ? runs.flatMap(runToLines) : ["> Live session — shared run output appears here"]} />
        </div>
      </div>
    </div>
  );
};

const SharedSandbox: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [files, setFiles] = useState<Map<string, SandboxFile>>(new Map());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialFiles, setInitialFiles] = useState<Record<string, SandboxFile>>({});
  const sessionId = searchParams.get("session");
  const sessionToken = searchParams.get("token");

  useEffect(() => {
    const loadSharedSandbox = async () => {
      if (!id) {
        setError("Sandbox ID not found");
        setLoading(false);
        return;
      }

      try {
        const sandbox = await loadSandbox(id);
        const fileMap = new Map(Object.entries(sandbox.files));
        setFiles(fileMap);
        setInitialFiles(sandbox.files);
        setSelectedFile(Object.keys(sandbox.files)[0]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load sandbox");
      } finally {
        setLoading(false);
      }
    };

    loadSharedSandbox();
  }, [id]);

  const startLiveSession = async () => {
    if (!id) return;
    try {
      const tokens = await createCollabSession(id);
      navigate(`/sandbox/${id}?session=${tokens.sessionId}&token=${tokens.ownerToken}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start live session");
    }
  };

  if (loading) {
    return (
      <div className="sandbox-container">
        <div className="sandbox-header">
          <h1>Soroban Sandbox</h1>
        </div>
        <div className="placeholder">Loading sandbox...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="sandbox-container">
        <div className="sandbox-header">
          <h1>Soroban Sandbox</h1>
        </div>
        <div className="placeholder" style={{ color: "#f48771" }}>
          ✗ {error}
        </div>
      </div>
    );
  }

  if (id && sessionId && sessionToken) {
    return (
      <LiveSession
        sandboxId={id}
        sessionId={sessionId}
        token={sessionToken}
        readOnly={searchParams.get("role") === "view"}
        initialFiles={initialFiles}
      />
    );
  }

  const currentFile = selectedFile ? files.get(selectedFile) : null;

  return (
    <div className="sandbox-container">
      <div className="sandbox-header">
        <h1>Soroban Sandbox - Read Only</h1>
        <button onClick={startLiveSession}>Start live session</button>
      </div>

      <div className="sandbox-layout">
        <FileExplorer files={Array.from(files.values())} selectedFile={selectedFile} onSelectFile={setSelectedFile} />

        <div className="editor-section">
          {currentFile ? (
            <div
              style={{
                height: "100%",
                overflow: "hidden",
                background: "#1e1e1e",
              }}
            >
              <div
                style={{
                  height: "100%",
                  color: "#d4d4d4",
                  fontSize: "12px",
                  fontFamily: "monospace",
                  padding: "12px",
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {currentFile.content}
              </div>
            </div>
          ) : (
            <div className="placeholder">Select a file to view</div>
          )}
        </div>

        <div className="right-panel">
          <div className="preview">
            <div className="preview-header">Info</div>
            <div className="preview-content">
              <p style={{ fontSize: "12px", color: "#bebebe" }}>
                This is a read-only view of a shared Soroban Sandbox.
              </p>
            </div>
          </div>
          <Terminal output={["> Shared sandbox loaded"]} />
        </div>
      </div>
    </div>
  );
};

export default SharedSandbox;
