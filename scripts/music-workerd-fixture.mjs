// Isolated Worker runtime smoke test. Uses real Cloudflare workerd via Miniflare.
// No Telegram tokens, production KV, Cloudflare account calls, external network, or audio.
import {searchMusic} from "../src/music/search.mjs";
import {recommendMusic} from "../src/music/recommendations.mjs";

const fixture={
  kind:"song",wrapperType:"track",trackId:987654321,
  trackName:"Test Song",artistName:"Test Artist",collectionName:"Test Album",
  releaseDate:"2020-02-02T00:00:00Z",primaryGenreName:"Pop",
  trackViewUrl:"https://music.apple.com/us/album/test-album/987654321?i=987654321"
};

function fakeProviderFetch(rawUrl) {
  const url=new URL(rawUrl);
  if (url.hostname==="itunes.apple.com") {
    return Promise.resolve(Response.json({resultCount:1,results:[fixture]}));
  }
  if (url.hostname==="api.audius.co") {
    if(url.pathname.endsWith("/tracks/trending"))return Promise.resolve(Response.json({data:[{
      id:"testTrack",title:"Verified Week Mock",user:{name:"Example Artist"},
      genre:"Pop",permalink:"/example-artist/verified-week-mock",
      release_date:"2026-09-09",play_count:456
    }]}));
    return Promise.resolve(Response.json({data:[]}));
  }
  throw Error("Unexpected network host");
}

export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if (url.pathname==="/health")return Response.json({ready:true,realNetwork:false});
    if(url.pathname==="/recommend"){
      const mode=url.searchParams.get("mode")??"week";
      const result=await recommendMusic(env,{
        language:"us",genre:"pop",mode,count:3,fetcher:fakeProviderFetch,now:Date.now()
      });
      return Response.json({status:result.status,fromCache:result.fromCache,
        count:result.tracks.length,rank:result.tracks[0]?.chart_rank??null,
        links:result.tracks.map(t=>t.play_url),sourceNote:result.sourceNote??null});
    }
    if (url.pathname!=="/search")return new Response("Not found",{status:404});
    const query=url.searchParams.get("query")??"Fixture Artist";
    const result=await searchMusic(env,{
      language:"us",query,fetcher:fakeProviderFetch,now:Date.now()
    });
    return Response.json({
      status:result.status,fromCache:result.fromCache,
      count:result.tracks.length,
      links:result.tracks.map(x=>x.play_url),
      failedProviders:result.failedProviders
    });
  }
};
