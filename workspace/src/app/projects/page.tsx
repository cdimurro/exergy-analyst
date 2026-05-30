// @ts-nocheck
"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/custom/Button";
import { Card } from "@/components/ui/custom/Card";
import { Badge } from "@/components/ui/custom/Badge";
import { Skeleton } from "@/components/ui/custom/Skeleton";

export default function ProjectsPage() {
  const { data: session, status } = useSession();
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "loading") return;
    fetch("/api/projects")
      .then((r) => r.json())
      .then(setProjects)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [status]);

  // Not logged in
  if (status !== "loading" && !session) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center px-4 py-12">
        <Card className="w-full max-w-md p-8 text-center">
          <img src="/logo.png" alt="Exergy Lab" className="h-12 w-auto mx-auto mb-4" />
          <h1 className="text-[20px] font-bold text-[var(--text-primary)] mb-2">Sign in to view your projects</h1>
          <p className="text-[14px] text-[var(--text-muted)] leading-relaxed mb-6">
            Create an account to save your projects, analyses, and evaluation history.
            Your work is preserved and accessible from any device.
          </p>
          <div className="flex items-center justify-center gap-3 mb-4">
            <Link href="/login"><Button variant="primary" size="md">Log In</Button></Link>
            <Link href="/signup"><Button variant="secondary" size="md">Sign Up</Button></Link>
          </div>
          <p className="text-[13px] text-[var(--text-dim)]">
            Or <Link href="/" className="text-[var(--accent-blue)] hover:underline">create a new project</Link> to try the platform
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[24px] font-bold text-[var(--text-primary)]">My Projects</h1>
          <p className="text-[13px] text-[var(--text-muted)]">{projects.length} project{projects.length !== 1 ? "s" : ""}</p>
        </div>
        <Link href="/">
          <Button variant="primary" size="md">Create New Project</Button>
        </Link>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-5">
              <Skeleton height={16} width="60%" className="mb-3" />
              <Skeleton height={12} width="40%" className="mb-2" />
              <Skeleton height={12} width="80%" />
            </Card>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-[14px] text-[var(--text-muted)] mb-4">No projects yet. Create your first project to get started.</p>
          <Link href="/">
            <Button variant="primary" size="md">Create New Project</Button>
          </Link>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((p: any) => (
            <Link key={p.id} href={`/projects/${p.id}`}>
              <Card variant="interactive" className="p-5 h-full">
                <h3 className="text-[14px] font-semibold text-[var(--text-primary)] mb-1 line-clamp-1">{p.name}</h3>
                <div className="flex items-center gap-2 mb-2">
                  <Badge>{p.domain || "general"}</Badge>
                </div>
                <p className="text-[12px] text-[var(--text-dim)] line-clamp-2">{p.description || "No description"}</p>
                <p className="text-[11px] text-[var(--text-dim)] mt-3">
                  {new Date(p.updated_at || p.created_at).toLocaleDateString()}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
