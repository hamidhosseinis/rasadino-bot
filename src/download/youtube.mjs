// YouTube URL validation and a public, authenticated file-delivery backend.
// Workers cannot run yt-dlp; no download is claimed unless a backend accepts a job.
export function canonicalYouTubeVideoUrl(value) {
  if(typeof value !== "string" || value.length > 500 || /\s/.test(value))return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if(url.protocol !== "https:" || url.username || url.password || url.port)return null;
  const host = url.hostname.toLowerCase();
  let id = null;
  if(host === "youtu.be" || host === "www.youtu.be"){
    const path = url.pathname.split("/").filter(Boolean);
    if(path.length === 1)id = path[0];
  } else if(["youtube.com","www.youtube.com","m.youtube.com","music.youtube.com"].includes(host)){
    const parts = url.pathname.split("/").filter(Boolean);
    if(parts.length === 1 && parts[0] === "watch")id = url.searchParams.get("v");
    else if(parts.length === 2 && ["shorts","live","embed"].includes(parts[0]))id = parts[1];
  }
  if(!/^[A-Za-z0-9_-]{11}$/.test(id || ""))return null;
  return "https://www.youtube.com/watch?v=" + id;
}

export function downloaderConfigured(env) {
  if(!env?.YOUTUBE_DOWNLOAD_SERVICE_URL || !env?.YOUTUBE_DOWNLOAD_API_KEY)return false;
  try {
    const target = new URL(env.YOUTUBE_DOWNLOAD_SERVICE_URL);
    return target.protocol === "https:" && target.username === "" &&
      target.password === "" && target.pathname.endsWith("/jobs");
  } catch { return false; }
}

export async function submitYouTubeJob(env, chatId, rawUrl) {
  const url = canonicalYouTubeVideoUrl(rawUrl);
  if(!url)return {ok:false,reason:"invalid"};
  if(!downloaderConfigured(env))return {ok:false,reason:"unconfigured"};
  try {
    const response = await fetch(env.YOUTUBE_DOWNLOAD_SERVICE_URL, {
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "X-Download-Key":env.YOUTUBE_DOWNLOAD_API_KEY
      },
      body:JSON.stringify({chat_id:String(chatId),youtube_url:url}),
      signal:AbortSignal.timeout(9000)
    });
    return response.status === 202
      ? {ok:true,reason:"accepted"}
      : {ok:false,reason:"backend_unavailable"};
  } catch { return {ok:false,reason:"backend_unavailable"}; }
}
