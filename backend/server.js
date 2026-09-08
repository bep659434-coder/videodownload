const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

setInterval(() => {
    try {
        const files = fs.readdirSync(TEMP_DIR);
        const now = Date.now();
        files.forEach(f => {
            const p = path.join(TEMP_DIR, f);
            const stat = fs.statSync(p);
            if (now - stat.mtimeMs > 30*60*1000) fs.unlinkSync(p);
        });
    } catch {}
}, 30*60*1000);

app.get('/', (req, res) => {
    res.json({ 
        status: '✅ SnapVault All-Platform Backend Running',
        platforms: ['YouTube', 'Instagram', 'TikTok', 'Facebook', 'Twitter'],
        endpoints: ['/api/info', '/api/download', '/api/direct']
    });
});

function getYtDlpCommand(url) {
    const base = 'yt-dlp --no-playlist --no-warnings --no-check-certificate --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"';
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        return `${base} --extractor-args "youtube:player_client=android,web"`;
    } else if (url.includes('instagram.com')) {
        return `${base} --extractor-args "instagram:api_version=2"`;
    } else if (url.includes('tiktok.com')) {
        return `${base}`;
    } else {
        return base;
    }
}

function handleInfo(req, res) {
    const url = req.body.url || req.query.url;
    if (!url) return res.status(400).json({ error: 'URL required' });
    const ytdlpBase = getYtDlpCommand(url);
    const cmd = `${ytdlpBase} --dump-json "${url.replace(/"/g, '\\"')}"`;
    console.log('Fetching:', url);
    exec(cmd, { maxBuffer: 1024*1024*20, timeout: 60000 }, (err, stdout, stderr) => {
        if (err) {
            console.error('INFO ERROR:', stderr.slice(0,500));
            const fallback = `yt-dlp --no-playlist --dump-json --no-warnings "${url.replace(/"/g, '\\"')}"`;
            exec(fallback, { maxBuffer: 1024*1024*20, timeout: 60000 }, (err2, stdout2) => {
                if (err2) return res.status(500).json({ error: 'Failed to fetch info. Link invalid ya private video hai.', details: stderr.slice(0,800) });
                tryParse(stdout2, res);
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
            thumbnail: info.thumbnail || (info.thumbnails?.length ? info.thumbnails[info.thumbnails.length-1].url : ''),
            uploader: info.uploader || info.channel || '',
            duration: info.duration_string || '',
            platform: info.extractor || 'unknown',
        });
    } catch(e) { res.status(500).json({ error: 'Parse error' }); }
}
app.post('/api/info', handleInfo);
app.get('/api/info', handleInfo);

function handleDownload(req, res) {
    const url = req.body.url || req.query.url;
    const quality = req.body.quality || req.query.quality || 'best';
    if (!url) return res.status(400).json({ error: 'URL required' });
    const id = crypto.randomBytes(8).toString('hex');
    const ytdlpBase = getYtDlpCommand(url);
    const q = quality.toString().toLowerCase();
    let format = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best';
    if (q.includes('1080')) format = 'bestvideo[height<=1080][ext=mp4]+bestaudio/best[height<=1080]';
    else if (q.includes('720')) format = 'bestvideo[height<=720][ext=mp4]+bestaudio/best[height<=720]';
    else if (q.includes('480')) format = 'bestvideo[height<=480][ext=mp4]+bestaudio/best[height<=480]';
    else if (q.includes('4k') || q==='best') format = 'bestvideo[ext=mp4]+bestaudio/best';
    const outputTemplate = path.join(TEMP_DIR, `${id}.%(ext)s`);
    let cmd = '';
    if (q.includes('mp3')) {
        const audioQ = q.includes('320') ? '0' : '5';
        cmd = `${ytdlpBase} -f "bestaudio/best" -o "${outputTemplate}" --extract-audio --audio-format mp3 --audio-quality ${audioQ} "${url.replace(/"/g, '\\"')}"`;
    } else {
        cmd = `${ytdlpBase} -f "${format}" -o "${outputTemplate}" --merge-output-format mp4 "${url.replace(/"/g, '\\"')}"`;
    }
    exec(cmd, { maxBuffer: 1024*1024*100, timeout: 180000 }, (err, stdout, stderr) => {
        if (err) { console.error(stderr); return res.status(500).json({ error: 'Download failed', details: stderr.slice(0,1000) }); }
        const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(id));
        if (!files.length) return res.status(500).json({ error: 'File not found' });
        const target = files.find(f=>f.endsWith('.mp4')||f.endsWith('.mp3'))||files[0];
        const filePath = path.join(TEMP_DIR, target);
        const cleanName = `SnapVault_${Date.now()}.${target.split('.').pop()}`;
        res.download(filePath, cleanName, ()=>{ fs.unlink(filePath, ()=>{}); });
    });
}
app.post('/api/download', handleDownload);
app.get('/api/download', handleDownload);
app.get('/api/direct', (req, res) => {
    const url = req.query.url;
    const quality = req.query.quality || 'best';
    if (!url) return res.status(400).json({ error: 'URL required' });
    const ytdlpBase = getYtDlpCommand(url);
    const q = quality.toLowerCase();
    let f = 'best';
    if (q.includes('720')) f='best[height<=720]'; else if (q.includes('1080')) f='best[height<=1080]';
    exec(`${ytdlpBase} -f "${f}" -g "${url.replace(/"/g, '\\"')}"`, { timeout:60000 }, (err, stdout) => {
        if (err) return res.status(500).json({ error: 'Failed to get direct URL' });
        res.json({ downloadUrl: stdout.trim().split('\n')[0] });
    });
});
app.listen(PORT, ()=>console.log(`✅ ALL-PLATFORM backend running on ${PORT}`));
