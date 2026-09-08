const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Temp folder
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// ROOT ROUTE - Is se "Cannot GET /" khatam ho jayega
app.get('/', (req, res) => {
    res.send('✅ SnapVault Backend is Running! Use /api/info or /api/download');
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', yt_dlp: 'installed' });
});

// 1. INFO API - POST + GET dono
app.post('/api/info', handleInfo);
app.get('/api/info', (req, res) => {
    req.body = { url: req.query.url };
    handleInfo(req, res);
});

function handleInfo(req, res) {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });
    const cmd = `yt-dlp --no-playlist --dump-json --no-warnings "${url}"`;
    exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
        if (err) {
            console.error(stderr);
            return res.status(500).json({ error: 'Failed to fetch info. Link invalid ya private video hai.', details: stderr });
        }
        try {
            const info = JSON.parse(stdout);
            const response = {
                title: info.title,
                thumbnail: info.thumbnail,
                uploader: info.uploader,
                duration: info.duration_string,
                formats: info.formats ? info.formats.map(f => ({
                    quality: f.format_note || (f.height ? f.height + 'p' : 'unknown'),
                    ext: f.ext,
                    filesize: f.filesize,
                    url: f.url
                })).filter(f => f.ext === 'mp4').slice(-6) : [],
                best_formats: [
                    { label: 'Best Video (MP4)', quality: 'best', ext: 'mp4' },
                    { label: '1080p Full HD', quality: '1080', ext: 'mp4' },
                    { label: '720p HD', quality: '720', ext: 'mp4' },
                    { label: '480p', quality: '480', ext: 'mp4' },
                    { label: 'MP3 320kbps', quality: 'mp3-320', ext: 'mp3' },
                    { label: 'MP3 128kbps', quality: 'mp3-128', ext: 'mp3' },
                ]
            };
            res.json(response);
        } catch (e) {
            res.status(500).json({ error: 'Parse error' });
        }
    });
}

// 2. DOWNLOAD API - POST + GET dono (GitHub Pages ke liye GET zaroori hai)
app.post('/api/download', handleDownload);
app.get('/api/download', (req, res) => {
    // GitHub Pages window.location se GET bhejta hai
    req.body = { url: req.query.url, quality: req.query.quality };
    handleDownload(req, res);
});

function handleDownload(req, res) {
    const { url, quality } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });

    const id = crypto.randomBytes(8).toString('hex');
    let formatString = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';

    if (quality === '1080') formatString = 'bestvideo[height<=1080][ext=mp4]+bestaudio/best[height<=1080]';
    if (quality === '720') formatString = 'bestvideo[height<=720][ext=mp4]+bestaudio/best[height<=720]';
    if (quality === '480') formatString = 'bestvideo[height<=480][ext=mp4]+bestaudio/best[height<=480]';

    const outputTemplate = path.join(TEMP_DIR, `${id}.%(ext)s`);
    
    let cmd = `yt-dlp -f "${formatString}" -o "${outputTemplate}" --no-playlist "${url}"`;
    if (quality && quality.startsWith('mp3')) {
        cmd = `yt-dlp -f "bestaudio" -o "${outputTemplate}" --extract-audio --audio-format mp3 --audio-quality ${quality === 'mp3-320' ? '0' : '5'} --no-playlist "${url}"`;
    }

    exec(cmd, { maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
        if (err) {
            console.error(stderr);
            return res.status(500).json({ error: 'Download failed', details: stderr });
        }
        const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(id));
        if (files.length === 0) return res.status(500).json({ error: 'File not found after download' });
        
        const filePath = path.join(TEMP_DIR, files[0]);
        res.download(filePath, files[0], (err) => {
            fs.unlink(filePath, () => {});
        });
    });
}

// Simple direct streaming method
app.get('/api/direct', (req, res) => {
    const { url, quality } = req.query;
    if (!url) return res.status(400).json({ error: 'URL required' });
    const formatString = quality === '720' ? 'best[height<=720]' : 'best';
    const cmd = `yt-dlp -f "${formatString}" -g --no-playlist "${url}"`;
    exec(cmd, (err, stdout) => {
        if (err) return res.status(500).json({ error: 'Failed' });
        const directUrl = stdout.trim().split('\n')[0];
        res.json({ downloadUrl: directUrl });
    });
});

app.listen(PORT, () => console.log(`SnapVault backend running on port ${PORT}`));
