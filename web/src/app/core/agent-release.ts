const repository = 'ViachaslauStrelnikau/PCinventory';
const executable = 'InventoryAgent.exe';
const buildOrder = new Intl.Collator('en', { numeric: true });

export const agentReleasesUrl = 'https://github.com/' + repository + '/releases';

type AgentRelease = { version: string; url: string };
type GitHubRelease = {
  tag_name: string;
  draft: boolean;
  assets: { name: string; state: string; browser_download_url: string }[];
};

export async function loadAgentRelease(): Promise<AgentRelease | null> {
  try {
    const response = await fetch('https://api.github.com/repos/' + repository + '/releases', {
      signal: AbortSignal.timeout(5000),
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) return null;
    const releases: GitHubRelease[] = await response.json();
    let latest: AgentRelease | null = null;
    for (const release of releases) {
      const version = /^windows-build-(\d+\.\d+)$/.exec(release.tag_name)?.[1];
      if (release.draft || !version || (latest && buildOrder.compare(version, latest.version) <= 0)) continue;
      const url = agentReleasesUrl + '/download/' + release.tag_name + '/' + executable;
      if (release.assets.some(asset => asset.name === executable && asset.state === 'uploaded'
        && asset.browser_download_url === url)) {
        latest = { version, url };
      }
    }
    return latest;
  } catch {
    return null;
  }
}
