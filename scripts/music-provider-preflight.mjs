// Read-only API connectivity preflight for the separate development branch.
// Never request audio bytes, use tokens, modify a provider, or log song/user data.
import {mkdir, writeFile} from "node:fs/promises";

const probes = [
  {
    id: "musicbrainz",
    url: "https://musicbrainz.org/ws/2/recording?query=recording%3ACreep%20AND%20artist%3ARadiohead&fmt=json&limit=1",
    check: value => Array.isArray(value.recordings) && value.recordings.length > 0
  },
  {
    id: "itunes_us",
    url: "https://itunes.apple.com/search?term=Daft%20Punk&entity=song&country=us&limit=1",
    check: value => Number(value.resultCount) > 0 && Array.isArray(value.results)
  },
  {
    id: "itunes_persian",
    url: "https://itunes.apple.com/search?term=Googoosh&entity=song&country=us&limit=1",
    check: value => Number(value.resultCount) > 0 && Array.isArray(value.results)
  },
  {
    id: "apple_rss",
    url: "https://rss.applemarketingtools.com/api/v2/us/music/most-played/10/songs.json",
    check: value => Array.isArray(value.feed?.results) && value.feed.results.length > 0
  },
  {
    id: "audius",
    url: "https://api.audius.co/v1/tracks/trending?limit=1",
    check: value => Array.isArray(value.data) && value.data.length > 0
  }
];

const results = [];
for (const probe of probes) {
  let result = {provider:probe.id,verified:false};
  try {
    const response = await fetch(probe.url, {
      headers:{"Accept":"application/json",
        "User-Agent":"Rasadino-Music-Preflight/0.1 (https://github.com/hamidhosseinis/rasadino-bot)"},
      signal:AbortSignal.timeout(10000)
    });
    result.http_status = response.status;
    if (response.ok) {
      const json = await response.json();
      result.verified = Boolean(probe.check(json));
      result.reason = result.verified ? "valid_json_and_expected_fields" : "missing_expected_fields";
    } else {
      result.reason = "http_error";
    }
  } catch (error) {
    result.reason = error?.name === "TimeoutError" ? "timeout" : "network_or_parse_error";
  }
  results.push(result);
  console.log(probe.id + ": " + (result.verified ? "VERIFIED" : "NOT VERIFIED") +
    (result.http_status ? " (HTTP " + result.http_status + ")" : "") + " — " + result.reason);
  await new Promise(resolve => setTimeout(resolve, 1100));
}
await mkdir("artifacts",{recursive:true});
await writeFile("artifacts/music-provider-preflight.json",JSON.stringify({
  schema:"rasadino-music-preflight-v1",generated_at:new Date().toISOString(),results
},null,2));
console.log("Verified: " + results.filter(x=>x.verified).length + "/" + probes.length);
