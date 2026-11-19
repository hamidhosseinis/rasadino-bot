import {findAudioFiles} from "../src/music/audio.mjs";
const samples=["Variations for flute and piano","Beethoven","piano","Fur Elis"];
for(const name of samples){
  const url=new URL("https://commons.wikimedia.org/w/api.php");
  for(const [k,v] of Object.entries({
    action:"query",generator:"search",gsrsearch:"filetype:audio filemime:audio/mpeg "+name,gsrnamespace:"6",gsrlimit:"25",
    prop:"imageinfo",iiprop:"url|size|mime|extmetadata",format:"json",formatversion:"2"
  }))url.searchParams.set(k,v);
  try{
    const res=await fetch(url.href,{signal:AbortSignal.timeout(15000),
      headers:{"User-Agent":"RasadinoBot/1.0 (https://github.com/hamidhosseinis/rasadino-bot)"}});
    const json=await res.json();
    const pages=json?.query?.pages||[];
    const sample=pages.map(p=>({title:p.title,mime:p.imageinfo?.[0]?.mime,
      lic:p.imageinfo?.[0]?.extmetadata?.LicenseShortName?.value,
      licenseUrl:p.imageinfo?.[0]?.extmetadata?.LicenseUrl?.value}))
      .filter(x=>x.mime==="audio/mpeg"||/\.mp3$/i.test(x.title)).slice(0,5);
    const match=await findAudioFiles(name);
    console.log(JSON.stringify({name,status:res.status,count:pages.length,mp3Examples:sample,
      result:match.status,files:match.files?.map(f=>f.title)}));
  }catch(e){console.log(JSON.stringify({name,error:String(e)}));}
}
