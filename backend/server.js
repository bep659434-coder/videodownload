const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

app.get('/', (req,res)=>{
  res.json({ status: '✅ Video Download Hub v7 - SaveFrom Style Direct', youtube: 'Direct file, no Piped page, no popup' });
});

function getYtId(url){
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([^&?#\/]+)/);
  return m ? m[1] : null;
}

// SaveFrom style - use Cobalt API + Piped API direct stream
async function getCobaltUrl(youtubeUrl, quality='1080'){
  const instances = [
    'https://api.cobalt.tools',
    'https://co.wuk.sh',
    'https://api.cobalt.ahmedrangel.com'
  ];
  for(const api of instances){
    try{
      const r = await fetch(`${api}/api/json`,{
        method:'POST',
        headers:{'Content-Type':'application/json','Accept':'application/json'},
        body: JSON.stringify({ url: youtubeUrl, vQuality: quality, filenamePattern: 'basic', isAudioOnly: false })
      });
      if(!r.ok) continue;
      const j = await r.json();
      if(j.url){ console.log(`[COBALT OK] ${api} => ${j.url.slice(0,80)}`); return j.url; }
    }catch(e){ console.log(`[COBALT FAIL] ${api} ${e.message}`); }
  }
  return null;
}

async function getPipedDirectUrl(videoId, quality='1080'){
  const apis = [
    'https://pipedapi.kavin.rocks',
    'https://api.piped.private.coffee',
    'https://pipedapi.moomoo.me',
    'https://pipedapi.adminforge.de',
    'https://pipedapi.leptun.cz'
  ];
  for(const base of apis){
    try{
      const r = await fetch(`${base}/streams/${videoId}`, { headers:{'User-Agent':'Mozilla/5.0'} });
      if(!r.ok) continue;
      const data = await r.json();
      if(!data.videoStreams) continue;
      // filter mp4
      let streams = data.videoStreams.filter(s=>s.mimeType && s.mimeType.includes('mp4'));
      if(streams.length===0) streams = data.videoStreams;
      // sort by quality
      const q = quality.includes('1080') ? 1080 : quality.includes('720') ? 720 : quality.includes('480') ? 480 : 1080;
      let best = streams.filter(s=>s.height===q)[0] || streams.sort((a,b)=>b.height-a.height)[0];
      if(best && best.url){
        console.log(`[PIPED DIRECT OK] ${base} ${best.quality}`);
        return best.url;
      }
    }catch(e){ continue; }
  }
  return null;
}

app.post('/api/info', async (req,res)=>{
  const url = (req.body.url || '').trim();
  if(!url) return res.status(400).json({error:'URL required'});
  const ytId = getYtId(url);
  if(ytId){
    return res.json({
      title: 'YouTube Video',
      thumbnail: `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`,
      uploader: 'YouTube',
      duration: '',
      platform: 'youtube',
      videoId: ytId
    });
  }
  // for FB/IG/TT use yt-dlp info
  const cmd = `yt-dlp --no-playlist --no-warnings --dump-json "${url.replace(/"/g,'\\"')}"`;
  exec(cmd, {timeout:30000, maxBuffer:1024*1024*10}, (err,stdout)=>{
    if(!err && stdout){
      try{
        const info = JSON.parse(stdout.split('\n')[0]);
        return res.json({ title: info.title || 'Video', thumbnail: info.thumbnail || '', uploader: info.uploader || '', platform: info.extractor || '' });
      }catch{}
    }
    return res.json({ title: 'Video', thumbnail: '', platform: 'unknown' });
  });
});

app.get('/api/download', async (req,res)=>{
  const url = (req.query.url || '').trim();
  const quality = (req.query.quality || '1080').trim();
  if(!url) return res.status(400).json({error:'URL required'});
  
  const ytId = getYtId(url);
  console.log(`[DOWNLOAD REQ] ${url.slice(0,80)} quality=${quality} ytId=${ytId}`);

  if(ytId){
    // 1. Try Cobalt (SaveFrom style - fastest direct link)
    let directUrl = await getCobaltUrl(url, quality);
    // 2. Fallback to Piped direct mp4 url
    if(!directUrl){
      directUrl = await getPipedDirectUrl(ytId, quality);
    }
    if(!directUrl){
      return res.status(500).json({error:'YouTube servers busy, 5 sec baad 720p try karo'});
    }
    // 3. Proxy the video so frontend gets direct file (NO popup, NO piped page)
    try{
      const videoRes = await fetch(directUrl, { headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'} });
      if(!videoRes.ok) throw new Error('fetch failed '+videoRes.status);
      const contentType = videoRes.headers.get('content-type') || 'video/mp4';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="youtube_${ytId}_${quality}.mp4"`);
      res.setHeader('Access-Control-Allow-Origin','*');
      const buf = Buffer.from(await videoRes.arrayBuffer());
      console.log(`[YOUTUBE DIRECT FILE] ${buf.length} bytes`);
      return res.send(buf);
    }catch(e){
      console.log(`[PROXY FAIL] ${e.message}, returning json url`);
      // If proxy fails due to size, return json so frontend can download directly (still no popup, we will use <a download> not window.open)
      return res.json({ downloadUrl: directUrl, filename: `youtube_${ytId}.mp4`, direct: true });
    }
  }

  // For Instagram / Facebook / TikTok - use yt-dlp file download (these already work for you)
  const id = crypto.randomBytes(8).toString('hex');
  const outTpl = path.join(TEMP_DIR, `${id}.%(ext)s`);
  const cmd = `yt-dlp --no-playlist -f "best" -o "${outTpl}" --merge-output-format mp4 "${url.replace(/"/g,'\\"')}"`;
  exec(cmd, {timeout:120000, maxBuffer:1024*1024*100}, (err)=>{
    try{
      const files = fs.readdirSync(TEMP_DIR).filter(f=>f.startsWith(id));
      if(files.length===0 || err) return res.status(500).json({error:'Download failed: '+ (err?.message||'')});
      const file = path.join(TEMP_DIR, files[0]);
      res.download(file, `video_${Date.now()}.mp4`, ()=>{ try{fs.unlinkSync(file);}catch{} });
    }catch(e){ res.status(500).json({error:e.message}); }
  });
});

app.post('/api/download', (req,res)=>{
  req.query.url = req.body.url;
  req.query.quality = req.body.quality;
  app._router.handle(req,res);
});

app.listen(PORT, ()=>console.log(`✅ v7 SaveFrom Direct running on ${PORT}`));
