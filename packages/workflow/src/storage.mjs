/** Local-only preview storage. Not a tenant boundary or a production database. */
export const STORAGE_KEY = 'navyix.local-workbench.v1';
export const MAX_WORKSPACE_BYTES = 3_000_000;
export const emptyWorkspace = () => ({ schemaVersion: 1, revision: 0, projects: [] });

export function readWorkspace(storage) {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return emptyWorkspace();
  if (new TextEncoder().encode(raw).byteLength > MAX_WORKSPACE_BYTES) throw new Error('Stored workspace exceeds the preview size limit. Export the raw data before resetting.');
  let workspace;
  try { workspace = JSON.parse(raw); } catch { throw new Error('Stored workspace is unreadable. It has not been overwritten. Export it before resetting.'); }
  if (workspace?.schemaVersion !== 1 || !Number.isSafeInteger(workspace.revision) || workspace.revision < 0 || !Array.isArray(workspace.projects) || workspace.projects.length > 20) throw new Error('Stored workspace has an unsupported format. It has not been overwritten.');
  const ids = new Set();
  for (const project of workspace.projects) {
    const arrays = ['requirements', 'designs', 'builds', 'testCases', 'reports', 'assessments', 'activity'];
    const strings = ['id', 'name', 'goal', 'owner', 'environment', 'createdAt', 'updatedAt'];
    if (!project || project.schemaVersion !== 1 || strings.some(k => typeof project[k] !== 'string') || arrays.some(k => !Array.isArray(project[k])) || !Number.isSafeInteger(project.revision) || ids.has(project.id)) throw new Error('A stored project is invalid. Export the raw data before resetting.');
    const rows = (items, keys, numeric = []) => items.every(item => item && typeof item === 'object' && keys.every(k => typeof item[k] === 'string') && numeric.every(k => Number.isSafeInteger(item[k]) && item[k] >= 0));
    const valid = rows(project.requirements, ['id', 'title', 'acceptance', 'owner', 'updatedAt'], ['revision']) &&
      rows(project.designs, ['id', 'title', 'decision', 'owner', 'createdAt']) && project.designs.every(d => Array.isArray(d.requirements) && rows(d.requirements, ['id'], ['revision'])) &&
      rows(project.builds, ['id', 'label', 'commitSha', 'artifactDigest', 'environment', 'status', 'builtAt'], ['requirementsVersion', 'designVersion']) &&
      rows(project.testCases, ['id', 'title', 'requirementId', 'steps', 'expected', 'owner', 'updatedAt'], ['revision', 'requirementRevision']) &&
      rows(project.reports, ['projectId', 'runId', 'buildId', 'artifactDigest', 'environment', 'executedAt', 'importedAt']) && project.reports.every(r => Array.isArray(r.results) && rows(r.results, ['testCaseId', 'status'], ['testCaseRevision'])) &&
      rows(project.assessments, ['id', 'stage', 'status', 'environment', 'evaluatedAt', 'policyVersion'], ['projectRevision', 'met', 'total']) && project.assessments.every(a => Array.isArray(a.criteria)) &&
      rows(project.activity, ['at', 'detail']);
    if (!valid) throw new Error('Stored project records are invalid. Export the raw data before resetting.');
    ids.add(project.id);
  }
  return workspace;
}

/** Storage errors must propagate: do not present unsaved work as saved. */
export function saveWorkspace(storage, workspace, expectedRevision) {
  const current = readWorkspace(storage);
  if (current.revision !== expectedRevision) throw new Error('Workspace changed in another tab. Reload before saving.');
  if (workspace.projects.length > 20) throw new Error('The local preview supports up to 20 projects.');
  const next = { ...workspace, revision: expectedRevision + 1 };
  const raw = JSON.stringify(next);
  if (new TextEncoder().encode(raw).byteLength > MAX_WORKSPACE_BYTES) throw new Error('Local storage limit reached. Export your work before clearing data.');
  storage.setItem(STORAGE_KEY, raw);
  return next;
}
