// Stage 5 provider smoke check. Public search metadata only. No API keys, chat IDs, media or caching.
import {searchITunes,searchAudius} from "../src/music/providers.mjs";
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
