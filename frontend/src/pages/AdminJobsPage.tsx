import { useEffect, useState } from "react";

type Job = { id: number; kind: string; priority_class: string; status: string; progress: number; attempts: number; tenant_id?: string };

export default function AdminJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const load = async () => {
    try { const response = await fetch("/api/admin/jobs"); if (!response.ok) throw new Error("Unable to load jobs"); const data = await response.json(); setJobs(data.data ?? []); setError(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to load jobs"); }
  };
  useEffect(() => { void load(); }, []);
  const cancel = async (id: number) => { await fetch(`/api/admin/jobs/${id}/cancel`, { method: "POST" }); await load(); };
  return <section aria-labelledby="jobs-heading"><div className="page-header"><div><h1 id="jobs-heading">Background jobs</h1><p>Prioritized work, progress, and resource fairness.</p></div><button type="button" onClick={load}>Refresh</button></div>{error && <p role="alert">{error}</p>}<div className="card"><table><thead><tr><th>Job</th><th>Class</th><th>Status</th><th>Progress</th><th>Attempts</th><th /></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td>{job.kind}</td><td>{job.priority_class}</td><td>{job.status}</td><td>{Number(job.progress || 0).toFixed(0)}%</td><td>{job.attempts}</td><td>{["queued", "running"].includes(job.status) && <button type="button" onClick={() => cancel(job.id)}>Cancel</button>}</td></tr>)}</tbody></table>{jobs.length === 0 && <p>No background jobs.</p>}</div></section>;
}
