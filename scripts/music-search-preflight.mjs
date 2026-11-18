// Stage 5 provider smoke check. Public search metadata only. No API keys, chat IDs, media or caching.
import {searchITunes,searchAudius,normalizeAudius,officialLink} from "../src/music/providers.mjs";
const tasks=[
  ["itunes_us",()=>searchITunes("Taylor Swift")],
  ["itunes_persian_artist",()=>searchITunes("Googoosh")],
  ["itunes_persian_script",()=>searchITunes("گوگوش")],
  ["audius_search",()=>searchAudius("Skrillex")],
  ["audius_generic_music",()=>searchAudius("music")],
  ["audius_electronic",()=>searchAudius("electronic")]
];
let ok=0;
for(const [label,run] of tasks) {
  try{
    const rows=await run();
    const valid=rows.length>0;
    console.log(label+": "+(valid?"VERIFIED":"NO MATCHES")+" (metadata results="+rows.length+")");
    if(valid)ok++;
  }catch(error){
    const status=/HTTP (\d{3})/.exec(String(error?.message))?.[1]??"error";
    console.log(label+": UNAVAILABLE ("+status+")");
  }
  await new Promise(resolve=>setTimeout(resolve,1200));
}
console.log("Search metadata providers verified: "+ok+"/"+tasks.length);


try {
  const raw=await fetch("https://api.audius.co/v1/tracks/search?query=music&limit=3&app_name=Rasadino",{
    headers:{"Accept":"application/json"},signal:AbortSignal.timeout(7500)
  });
  const data=await raw.json();
  const list=Array.isArray(data?.data)?data.data:[];
  const first=list[0]??{};
  // Diagnostics log only object shape, never track titles, user handles or URLs.
  console.log("audius_response_shape: "+JSON.stringify({
    http_status:raw.status,
    data_count:list.length,
    top_level_keys:Object.keys(data??{}).slice(0,10),
    item_field_types:Object.fromEntries(["id","title","permalink","user","genre"].map(k=>[k,typeof first[k]])),
    user_field_types:Object.fromEntries(["name","handle"].map(k=>[k,typeof first.user?.[k]])),
    id_pattern_match:typeof first.id==="string" && /^[A-Za-z0-9_-]{2,80}$/.test(first.id),
    title_present:typeof first.title==="string" && first.title.trim().length>0,
    artist_present:typeof first.user?.name==="string" && first.user.name.trim().length>0,
    official_link_accepted:Boolean(officialLink(first.permalink,"audius")),
    normalized:Boolean(normalizeAudius(first)),
    permalink_is_absolute:typeof first.permalink==="string" && first.permalink.startsWith("https://"),
    permalink_host:(()=>{try{return new URL(first.permalink).host}catch{return "not_absolute"}})(),
    permalink_prefix_character:typeof first.permalink==="string" ? first.permalink.slice(0,1) : null,
    permalink_has_slash:typeof first.permalink==="string" && first.permalink.includes("/"),
    permalink_has_colon:typeof first.permalink==="string" && first.permalink.includes(":"),
    permalink_length:typeof first.permalink==="string" ? first.permalink.length : null
  }));
}catch(e){console.log("audius_response_shape: unavailable ("+(e?.name??"network")+")");}
