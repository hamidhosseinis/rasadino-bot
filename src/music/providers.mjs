// Source-specific public METADATA search only. Never fetch/store preview audio, artwork or file bytes.
// Provider URLs are constructed from fixed hosts; outward links are restricted to official domains.
const SAFE_HTTPS = /^https:\/\//i;
export function officialLink(raw, provider) {
  if (typeof raw !== "string" || raw.length > 1300) return null;
  const isAudiusRelative = provider === "audius" &&
    /^\/(?!\/)[^\\\s?#]{2,1000}$/.test(raw);
  if (!SAFE_HTTPS.test(raw) && !isAudiusRelative) return null;
  try {
    // The Audius REST API currently returns root-relative permalinks such as
    // /artist/track; anchor them on the verified Audius domain.
    const target = isAudiusRelative ? "https://audius.co" + raw : raw;
    const url = new URL(target);
    const hosts = provider === "itunes"
      ? ["music.apple.com", "itunes.apple.com"]
      : provider === "audius" ? ["audius.co", "www.audius.co"] : [];
    return hosts.includes(url.hostname.toLowerCase()) && !url.username && !url.password
      ? url.href : null;
  } catch { return null; }
}

function safeText(value, limit=160) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g," ").replace(/\s+/g," ").trim().slice(0,limit)
    : "";
}

function releaseYear(value) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1950 && value <= new Date().getUTCFullYear()+1)
    return value;
  if (typeof value !== "string") return null;
  const match = /^(\d{4})(?:-|$)/.exec(value);
  const year = match ? Number(match[1]) : null;
  return year && year >= 1950 && year <= new Date().getUTCFullYear()+1 ? year : null;
}

export function normalizeITunes(item) {
  if (!item || item.kind !== "song" || item.wrapperType !== "track") return null;
  const title = safeText(item.trackName);
  const artist = safeText(item.artistName);
  const playUrl = officialLink(item.trackViewUrl,"itunes");
  if (!title || !artist || !playUrl || !Number.isSafeInteger(item.trackId)) return null;
  return {
    id: "itunes:" + item.trackId, title, artist,
    album: safeText(item.collectionName) || null,
    year: releaseYear(item.releaseDate),
    genre: safeText(item.primaryGenreName,80) || null,
    source: "iTunes", source_id:String(item.trackId), play_url:playUrl
  };
}

export function normalizeAudius(item) {
  if (!item || typeof item.id !== "string" || !/^[A-Za-z0-9_-]{2,80}$/.test(item.id)) return null;
  const title = safeText(item.title);
  const artist = safeText(item.user?.name);
  // Audius API search uses site-relative permalinks ("/artist/track").
  // Resolve only a single leading slash against Audius itself. Never accept
  // protocol-relative links, backslashes, or user-controlled external hosts.
  const rawLink = item.permalink;
  const relative = typeof rawLink === "string" && rawLink.startsWith("/")
    && !rawLink.startsWith("//") && !rawLink.includes("\\")
    && !/[\u0000-\u001f\u007f]/.test(rawLink);
  const playUrl = officialLink(relative ? "https://audius.co" + rawLink : rawLink, "audius");
  if (!title || !artist || !playUrl) return null;
  return {
    id:"audius:" + item.id, title, artist, album:null,
    year:releaseYear(item.releaseDate ?? item.release_date),
    genre:safeText(item.genre,80) || null,
    source:"Audius", source_id:item.id, play_url:playUrl
  };
}

async function jsonRequest(url,{fetcher, timeoutMs=6500, headers={}}) {
  const response = await fetcher(url,{
    method:"GET",
    headers:{"Accept":"application/json",...headers},
    signal:AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error("Music source HTTP "+response.status);
  // Avoid unbounded provider payloads; search uses limit=12.
  const size = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(size) && size > 300_000) throw new Error("Oversized metadata");
  // Mock fetch implementations used by tests may provide json() only.
  const data=await response.json();
  if (!data || typeof data !== "object") throw new Error("Invalid metadata");
  return data;
}

export async function searchITunes(query,{fetcher=globalThis.fetch}={}) {
  const url=new URL("https://itunes.apple.com/search");
  url.searchParams.set("term",query);
  url.searchParams.set("media","music");
  url.searchParams.set("entity","song");
  url.searchParams.set("country","US");
  url.searchParams.set("limit","12");
  const data=await jsonRequest(url.href,{fetcher});
  if (!Array.isArray(data.results)) throw new Error("Invalid iTunes search response");
  return data.results.slice(0,12).map(normalizeITunes).filter(Boolean);
}

export async function searchAudius(query,{fetcher=globalThis.fetch}={}) {
  const url=new URL("https://api.audius.co/v1/tracks/search");
  url.searchParams.set("query",query);
  url.searchParams.set("limit","12");
  url.searchParams.set("app_name","Rasadino");
  const data=await jsonRequest(url.href,{fetcher});
  if (!Array.isArray(data.data)) throw new Error("Invalid Audius search response");
  return data.data.slice(0,12).map(normalizeAudius).filter(Boolean);
}
