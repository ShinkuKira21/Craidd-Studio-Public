import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

const apiBase = "http://127.0.0.1:5087";

type WorkItem = { id: number; title: string; completed: boolean };
type Health = { service: string; environment: string; dataset: string; timeUtc: string };

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [rustMessage, setRustMessage] = useState("");

  async function refresh() {
    try {
      const [healthResponse, itemsResponse] = await Promise.all([
        fetch(`${apiBase}/api/health`), fetch(`${apiBase}/api/work`),
      ]);
      if (!healthResponse.ok || !itemsResponse.ok) throw new Error("API returned an error");
      setHealth(await healthResponse.json() as Health);
      setItems(await itemsResponse.json() as WorkItem[]);
      setError("");
    } catch (reason) {
      setHealth(null);
      setError(`API unavailable at ${apiBase}: ${String(reason)}`);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function addItem(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch(`${apiBase}/api/work`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }).catch((reason) => { setError(String(reason)); return null; });
    if (!response) return;
    if (!response.ok) { setError(await response.text()); return; }
    setTitle("");
    await refresh();
  }

  async function completeItem(id: number) {
    const response = await fetch(`${apiBase}/api/work/${id}/complete`, { method: "POST" })
      .catch((reason) => { setError(String(reason)); return null; });
    if (response?.ok) await refresh();
  }

  async function pingRust() {
    try { setRustMessage(await invoke<string>("backend_label")); }
    catch { setRustMessage("Rust command requires the Tauri window."); }
  }

  return (
    <main>
      <header>
        <p className="eyebrow">Craidd Studio · polyglot workspace</p>
        <h1>Client ↔ API lab</h1>
        <p>A Tauri 2 frontend, Rust command, C# server, and C# tests in one solution.</p>
      </header>
      <section className="status">
        <div><span className={health ? "lamp ok" : "lamp"} />API: {health ? "connected" : "offline"}</div>
        {health && <small>{health.environment} · {health.dataset} · {health.timeUtc}</small>}
        <button onClick={() => void refresh()}>Refresh</button>
      </section>
      {error && <p className="error" role="alert">{error}</p>}
      <section>
        <h2>Work items</h2>
        <form onSubmit={(event) => void addItem(event)}>
          <input value={title} onChange={(event) => setTitle(event.target.value)}
            placeholder="Add a work item" aria-label="Work item title" />
          <button disabled={!health || title.trim().length < 2}>Add</button>
        </form>
        <ul>{items.map((item) => <li key={item.id}>
          <span className={item.completed ? "done" : ""}>{item.title}</span>
          <button disabled={item.completed} onClick={() => void completeItem(item.id)}>
            {item.completed ? "Done" : "Complete"}
          </button>
        </li>)}</ul>
      </section>
      <section className="rust">
        <h2>Rust backend</h2>
        <button onClick={() => void pingRust()}>Invoke Tauri command</button>
        <span>{rustMessage}</span>
      </section>
    </main>
  );
}
