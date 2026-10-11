import { busiestLabel, severityCounts, typeCounts, type CountRow } from "../issues/stats";
import type { Project, Task } from "../types";

interface StatsPageProps {
  tasks: Task[];
  projects: Project[];
  projectFilter: string | "all";
}

export function StatsPage({ tasks, projects, projectFilter }: StatsPageProps) {
  const scoped = tasks.filter((task) => projectFilter === "all" || task.projectId === projectFilter);
  const projectName = projects.find((project) => project.id === projectFilter)?.name ?? "All projects";
  const types = typeCounts(scoped);
  const severities = severityCounts(scoped);
  const issueWord = scoped.length === 1 ? "issue" : "issues";

  return (
    <main className="stats-page">
      <header>
        <h2>Statistics</h2>
        <p className="muted">
          {scoped.length} {issueWord} in {projectName}. The bars count every issue in the project selected on the left.
        </p>
      </header>
      <BarChart title="Issue type" summary={busiestLabel(types)} rows={types} />
      <BarChart title="Severity" summary={busiestLabel(severities)} rows={severities} />
    </main>
  );
}

function BarChart({ title, summary, rows }: { title: string; summary: string | null; rows: CountRow[] }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <section className="stat-card" aria-label={title}>
      <h3>{title}</h3>
      {summary ? <p className="muted">{summary}</p> : <p className="muted">No issues in this view yet.</p>}
      <ul className="bar-list">
        {rows.map((row) => (
          <li key={row.id} className="bar-row">
            <span>{row.label}</span>
            <span className="bar-track" role="img" aria-label={`${row.label}: ${row.count}`}>
              <span className={`bar-fill tone-${row.tone}`} style={{ width: `${(row.count / max) * 100}%` }} />
            </span>
            <span className="bar-count">{row.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
