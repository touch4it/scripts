export type Remote = {
  host: string;
  project: string;
};

/**
 * Split a git remote URL into its GitLab host and project path.
 * Returns undefined for anything that is not a host-based remote (local paths, file://).
 */
export function parseRemote(url: string | undefined): Remote | undefined {
  const stripped = String(url ?? '')
    .trim()
    .replace(/\.git$/, '');
  let host: string;
  let project: string;

  const schemeAt = stripped.indexOf('://');
  if (schemeAt !== -1) {
    let rest = stripped.slice(schemeAt + 3);
    const at = rest.indexOf('@');
    if (at !== -1) {
      rest = rest.slice(at + 1);
    }

    const slash = rest.indexOf('/');
    if (slash === -1) {
      return undefined;
    }

    host = rest.slice(0, slash).split(':')[0] ?? '';
    project = rest.slice(slash + 1);
  } else if (stripped.includes(':')) {
    let rest = stripped;
    const at = rest.indexOf('@');
    if (at !== -1) {
      rest = rest.slice(at + 1);
    }

    const colon = rest.indexOf(':');
    host = rest.slice(0, colon);
    project = rest.slice(colon + 1);
  } else {
    return undefined;
  }

  project = project.replace(/^\/+/, '');
  if (!host || !project) {
    return undefined;
  }

  return {host, project};
}

export function newMergeRequestUrl({host, project, branch}: Remote & {branch: string}): string {
  const source = encodeURIComponent(branch);
  return `https://${host}/${project}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${source}`;
}
