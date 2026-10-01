export interface InternalJobEntry {
  id: string;
  kind: "job";
  registry: "internal";
  title: string;
  summary: string;
  library_id: string;
  execution_mode: "direct";
  executor: "builtin:tbh-toolkit-loader";
  resource_root: string;
  class: string;
  subclass: string;
  status: string;
  risk: "low" | "medium" | "high";
}

const INTERNAL_JOBS: InternalJobEntry[] = [
  {
    id: "tbh",
    kind: "job",
    registry: "internal",
    title: "TBH Toolkit Loader",
    summary:
      "Load the official TBH Toolkit into the currently bound AutoCAD drawing through one generated fail-fast batch Lisp and a single verified CadGPT Lisp bridge call.",
    library_id: "tbh-toolkit",
    execution_mode: "direct",
    executor: "builtin:tbh-toolkit-loader",
    resource_root: "resources/cad/internal-lisp/tbh-toolkit",
    class: "workflow.internal",
    subclass: "direct",
    status: "active",
    risk: "medium",
  },
];

export function listInternalJobs(): InternalJobEntry[] {
  return INTERNAL_JOBS.map((job) => ({ ...job }));
}

export function getInternalJob(id: string): InternalJobEntry | undefined {
  const needle = id.trim().toLowerCase();
  return INTERNAL_JOBS.find((job) => job.id.toLowerCase() === needle);
}

export function isInternalJobId(id: string): boolean {
  return Boolean(getInternalJob(id));
}
