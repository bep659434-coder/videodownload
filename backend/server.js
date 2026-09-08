const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

app.get('/', (req, res) => {
    res.json({ status: '✅ SnapVault All-Platform Backend Running', platforms: ['YouTube','Instagram','TikTok','Facebook','Twitter'], note: 'All platforms fixed' });
});

function getBaseCmd(url) {
    const base = 'yt-dlp --no-playlist --no-warnings --no-check-certificate --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"';
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        return `${base} --extractor-args "youtube:player_client=android,web"`;
    }
    return base;
}

function handleInfo(req, res) {
    const url = (req.body.url || req.query.url || '').trim();
    if (!url) return res.status(400).json({ error: 'URL required' });
    console.log(`[INFO] ${url}`);
    const cmd = `${getBaseCmd(url)} --dump-json "${url.replace(/"/g, '\\"')}"`;
    exec(cmd, { maxBuffer: 1024*1024*30, timeout: 90000 }, (err, stdout, stderr) => {
        if (err) {
            console.error('[INFO FAIL]', stderr.slice(0,800));
            exec(`yt-dlp --no-playlist --dump-json --no-warnings "${url.replace(/"/g, '\\"')}"`, { maxBuffer: 1024*1024*20, timeout: 90000 }, (e2, s2) => {
                if (e2) return res.status(500).json({ error: 'Failed to fetch info. Link invalid ya private video hai.', details: stderr?.slice(0,800) });
                tryParse(s2, res);
            });
            return;
        }
        tryParse(stdout, res);
    });
}

function tryParse(stdout, res) {
    try {
        const info = JSON.parse(stdout);
        res.json({
            title: info.title || 'Video',
            thumbnail: info.thumbnail || (info.thumbnails?.length? info.thumbnails[info.thumbnails.length-1].url : ''),
            uploader: info.uploader || info.channel || '',
            duration: info.duration_string || '',
            platform: info.extractor || 'unknown',
        });
    } catch { res.status(500).json({ error: 'Parse error' }); }
}

app.post('/api/info', handleInfo);
app.get('/api/info', handleInfo);

function handleDownload(req, res) {
    const url = (req.body.url || req.query.url || '').trim();
    const quality = req.body.quality || req.query.quality || 'best';
    if (!url) return res.status(400).json({ error: 'URL required' });

    const id = crypto.randomBytes(8).toString('hex');
    const isFacebook = url.includes('facebook.com') || url.includes('fb.watch');
    const isInstagram = url.includes('instagram.com');
    const isTikTok = url.includes('tiktok.com');

    // FIX: Facebook/Instagram/TikTok ke liye hamesha best - 1080p error khatam
    let format = 'best';
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        const q = quality.toString().toLowerCase();
        if (q.includes('1080')) format = 'bestvideo[height<=1080][ext=mp4]+bestaudio/best[height<=1080]/best';
        else if (q.includes('720')) format = 'bestvideo[height<=720][ext=mp4]+bestaudio/best[height<=720]/best';
        else if (q.includes('480')) format = 'bestvideo[height<=480][ext=mp4]+bestaudio/best[height<=480]/best';
        else format = 'bestvideo[ext=mp4]+bestaudio/best[ext=mp4]/best';
    } else {
        format = 'best';
        if (quality.toString().includes('mp3')) format = 'bestaudio/best';
    }

    const qLower = quality.toString().toLowerCase();
    const isAudio = qLower.includes('mp3');
    const outputTemplate = path.join(TEMP_DIR, `${id}.%(ext)s`);
    const base = getBaseCmd(url);

    let cmd = '';
    if (isAudio) {
        const audioQ = qLower.includes('320')? '0' : '5';
        cmd = `${base} -f "bestaudio/best" -o "${outputTemplate}" --extract-audio --audio-format mp3 --audio-quality ${audioQ} "${url.replace(/"/g, '\\"')}"`;
    } else {
        cmd = `${base} -f "${format}" -o "${outputTemplate}" --merge-output-format mp4 "${url.replace(/"/g, '\\"')}"`;
    }

    console.log(`[DOWNLOAD] ${url.slice(0,70)} | ${isFacebook?'FB':isInstagram?'IG':isTikTok?'TT':'YT'} | ${quality} | ${format}`);

    exec(cmd, { maxBuffer: 1024*1024*150, timeout: 180000 }, (err, stdout, stderr) => {
        if (err) {
            console.error('[FAIL 1]', stderr.slice(0,1000));
            const fallback1 = `${base} -f "best" -o "${outputTemplate}" --merge-output-format mp4 "${url.replace(/"/g, '\\"')}"`;
            console.log('[RETRY] best');
            exec(fallback1, { maxBuffer: 1024*1024*150, timeout: 180000 }, (err2, s2, stderr2) => {
                if (err2) {
                    const fallback2 = `yt-dlp -f "best" -o "${outputTemplate}" "${url.replace(/"/g, '\\"')}"`;
                    exec(fallback2, { maxBuffer: 1024*1024*150, timeout: 180000 }, (err3, s3, stderr3) => {
                        if (err3) return res.status(500).json({ error: 'Download failed', details: stderr3.slice(0,1000) });
                        return sendFile(id, res);
                    });
                    return;
                }
                return sendFile(id, res);
            });
            return;
        }
        sendFile(id, res);
    });

    function sendFile(id, res) {
        try {
            const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(id));
            if (!files.length) return res.status(500).json({ error: 'File not found after download' });
            const target = files.find(f=>f.endsWith('.mp4')||f.endsWith('.mp3')||f.endsWith('.webm'))||files[0];
            const filePath = path.join(TEMP_DIR, target);
            const ext = target.split('.').pop();
            const cleanName = `SnapVault_${Date.now()}.${ext}`;
            console.log(`[SENDING] ${target}`);
            res.download(filePath, cleanName, ()=>{
                fs.unlink(filePath, ()=>{});
                files.forEach(f=>{ if(f!==target) try{fs.unlinkSync(path.join(TEMP_DIR,f))}catch{} });
            });
        } catch(e){ res.status(500).json({ error: e.message }); }
    }
}

app.post('/api/download', handleDownload);
app.get('/api/download', handleDownload);

app.get('/api/direct', (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).json({ error: 'URL required' });
    const base = getBaseCmd(url);
    const cmd = `${base} -f "best" -g "${url.replace(/"/g, '\\"')}"`;
    exec(cmd, { timeout: 60000 }, (err, stdout, stderr) => {
        if (err) return res.status(500).json({ error: 'Failed', details: stderr.slice(0,500) });
        res.json({ downloadUrl: stdout.trim().split('\n')[0] });
    });
});

app.listen(PORT, ()=>console.log(`✅ FINAL FIX backend running on ${PORT} - FB/IG/TT/YT all fixed`));
