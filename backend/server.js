const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json({ limit: '10mb' }));

const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

app.get('/', (req,res) => res.json({ status: 'v9 FIXED - 10 servers + auto quality fallback' }));

function getYtId(url){
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([^&?#\/]+)/);
  return m ? m[1] : null;
}

const COBALT_APIS = [
  'https://api.cobalt.tools',
  'https://co.wuk.sh',
  'https://api.cobalt.ahmedrangel.com',
  'https://cobalt.api.timelessnesses.me',
  'https://co.api.timelessnesses.me',
  'https://cobalt-api.kwiatekmiki.com'
];

const PIPED_APIS = [
  'https://pipedapi.kavin.rocks',
  'https://api.piped.private.coffee',
  'https://pipedapi.moomoo.me',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.leptun.cz',
  'https://api.piped.privacydev.net'
];

async function getCobaltDirect(youtubeUrl, quality){
  for(const api of COBALT_APIS){
    try{
      const controller = new AbortController();
      setTimeout(()=>controller.abort(), 9000);
      const r = await fetch(`${api}/api/json`, {
        method:'POST',
        headers:{'Content-Type':'application/json','Accept':'application/json','User-Agent':'Mozilla/5.0'},
        body: JSON.stringify({ url: youtubeUrl, vQuality: quality.replace('p',''), filenamePattern: 'basic', isAudioOnly: false }),
        signal: controller.signal
      });
      if(!r.ok) continue;
      const j = await r.json();
      if(j.url){ console.log(`[COBALT OK] ${api} q=${quality}`); return j.url; }
      if(j.error) console.log(`[COBALT ERR] ${api} ${j.error}`);
    }catch(e){ console.log(`[COBALT FAIL] ${api} ${e.message}`); }
  }
  return null;
}

async function getPipedDirect(videoId, quality){
  for(const base of PIPED_APIS){
    try{
      const controller = new AbortController();
      setTimeout(()=>controller.abort(), 8000);
      const r = await fetch(`${base}/streams/${videoId}`, { headers:{'User-Agent':'Mozilla/5.0'}, signal: controller.signal });
      if(!r.ok) continue;
      const data = await r.json();
      if(!data.videoStreams) continue;
      let streams = data.videoStreams.filter(s=>s.mimeType && s.mimeType.includes('mp4'));
      if(streams.length===0) streams = data.videoStreams;
      const qNum = parseInt(quality) || 1080;
      let best = streams.find(s=>s.height===qNum) || streams.filter(s=>s.height<=qNum).sort((a,b)=>b.height-a.height)[0] || streams.sort((a,b)=>b.height-a.height)[0];
      if(best?.url){ console.log(`[PIPED OK] ${base} ${best.quality}`); return best.url; }
    }catch(e){}
  }
  return null;
}

function ytdlpDownload(url, quality){
  return new Promise((resolve, reject)=>{
    const id = crypto.randomBytes(8).toString('hex');
    const outTpl = path.join(TEMP_DIR, `${id}.%(ext)s`);
    // Use android client to bypass IP block
    const fmt = quality.includes('1080') ? 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best' : quality.includes('720') ? 'best[height<=720]/best' : 'best';
    const cmd = `yt-dlp --no-playlist --extractor-args "youtube:player_client=android" -f "${fmt}" -o "${outTpl}" --merge-output-format mp4 "${url.replace(/"/g,'\"')}"`;
    console.log(`[YT-DLP TRY] ${fmt}`);
    exec(cmd, {timeout:90000, maxBuffer:1024*1024*50}, (err)=>{
      try{
        const files = fs.readdirSync(TEMP_DIR).filter(f=>f.startsWith(id));
        if(files.length===0) return reject(new Error('ytdlp failed'));
        const file = path.join(TEMP_DIR, files[0]);
        resolve(file);
      }catch(e){ reject(e); }
    });
  });
}

app.post('/api/info', (req,res)=>{
  const url = (req.body.url||'').trim();
  if(!url) return res.status(400).json({error:'URL required'});
  const ytId = getYtId(url);
  if(ytId){
    return res.json({ title: 'YouTube Video', thumbnail: `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`, platform:'youtube', videoId:ytId });
  }
  res.json({ title: 'Video', thumbnail: '' });
});

app.get('/api/download', async (req,res)=>{
  const url = (req.query.url||'').trim();
  let quality = (req.query.quality||'1080').trim();
  if(!url) return res.status(400).json({error:'URL required'});
  const ytId = getYtId(url);
  console.log(`[REQ] ${url.slice(0,80)} q=${quality} ytId=${ytId}`);

  if(ytId){
    // AUTO FALLBACK: 1080 -> 720 -> 480 -> 360
    const qualities = [quality, '720', '480', '360'].filter((v,i,a)=>a.indexOf(v)===i);
    for(const q of qualities){
      console.log(`[TRY Q] ${q}`);
      let directUrl = await getCobaltDirect(url, q);
      if(!directUrl) directUrl = await getPipedDirect(ytId, q);
      
      if(directUrl){
        try{
          const videoRes = await fetch(directUrl, { headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'} });
          if(!videoRes.ok) continue;
          const buf = Buffer.from(await videoRes.arrayBuffer());
          if(buf.length < 5000) continue;
          res.setHeader('Content-Type', 'video/mp4');
          res.setHeader('Content-Disposition', `attachment; filename="YT_${ytId}_${q}.mp4"`);
          res.setHeader('Access-Control-Allow-Origin','*');
          console.log(`[SUCCESS FILE] ${q} ${buf.length} bytes`);
          return res.send(buf);
        }catch(e){ console.log(`[PROXY FAIL] ${e.message}`); continue; }
      }
    }
    // Last resort: yt-dlp on server itself
    console.log('[LAST RESORT] yt-dlp android client');
    for(const q of qualities){
      try{
        const file = await ytdlpDownload(url, q);
        return res.download(file, `YT_${ytId}_${q}.mp4`, ()=>{ try{fs.unlinkSync(file);}catch{} });
      }catch(e){ console.log(`[YTDLP FAIL] ${q} ${e.message}`); }
    }
    return res.status(500).json({error:"YouTube ne Render ka IP block kiya hai. Koyeb pe deploy karo ya 2 min baad 480p try karo", suggestion:"Deploy on Koyeb.com - free and better IP"});
  }

  // IG / FB / TikTok
  try{
    const file = await ytdlpDownload(url, quality);
    return res.download(file, `video_${Date.now()}.mp4`, ()=>{ try{fs.unlinkSync(file);}catch{} });
  }catch(e){
    return res.status(500).json({error:'Download failed: '+e.message});
  }
});

app.listen(PORT, ()=>console.log(`✅ v9 FIXED running on ${PORT}`));
