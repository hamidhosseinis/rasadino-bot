// Metadata-only stage 6 preflight from GitHub runner (not the production bot).
// No Telegram token, chat ID, audio bytes, private KV or song values are printed.
import {getAudiusChart} from "../src/music/providers.mjs";
import {recommendMusic} from "../src/music/recommendations.mjs";

const kv=new Map(),STATE={
  async get(k){return kv.get(k)??null;},
  async put(k,v){kv.set(k,v)}
};
const checks=[
  ["audius_week",async()=>getAudiusChart({time:"week",genre:"Pop",limit:36})],
  ["audius_all_time",async()=>getAudiusChart({time:"allTime",limit:36})],
  ["audius_underground",async()=>getAudiusChart({underground:true,time:"week",limit:36})],
  ["persian_smart",async()=>{const r=await recommendMusic({STATE},{language:"fa",genre:"pop",mode:"smart",count:5});return r.tracks??[]}],
  ["us_smart",async()=>{const r=await recommendMusic({STATE},{language:"us",genre:"pop",mode:"smart",count:5});return r.tracks??[]}],
  ["us_new",async()=>{const r=await recommendMusic({STATE},{language:"us",genre:"pop",mode:"new",count:5});return r.tracks??[]}]
];
let verified=0;
for(const [label,fn] of checks){
  try{
    const tracks=await fn();
    const usable=Array.isArray(tracks)&&tracks.length>0;
    if(usable)verified++;
    console.log(label+": "+(usable?"VERIFIED":"EMPTY")+", valid tracks="+tracks.length);
  }catch(e){
    const code=/HTTP (\d{3})/.exec(String(e?.message))?.[1]??"network_or_shape_failure";
    console.log(label+": ERROR "+code);
  }
  await new Promise(done=>setTimeout(done,1200));
}
console.log("Stage 6 metadata checks with nonempty results: "+verified+"/"+checks.length);
if(verified<3)process.exitCode=1;
