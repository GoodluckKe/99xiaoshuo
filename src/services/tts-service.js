const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

function commandExists(command) {
  try {
    const which = require('child_process').spawnSync('which', [command], {
      stdio: 'ignore',
    });
    return which.status === 0;
  } catch {
    return false;
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 1024 * 1024 * 8 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || stdout || error.message || String(error)));
        return;
      }
      resolve();
    });
  });
}

class ReaderTtsService {
  constructor(options = {}) {
    this.cacheDir = options.cacheDir || path.join(os.tmpdir(), '99xiaoshuo-tts-cache');
    this.publicMount = options.publicMount || '/assets/tts';
    this.maxChars = Math.max(300, Number(options.maxChars || 6000));
    this.voiceMap = {
      loli: 'Tingting',
      yujie: 'Meijia',
      ceo: 'Rocko',
      gentle: 'Eddy',
      news: 'Flo',
    };
    this.provider =
      process.platform === 'darwin' && commandExists('say') && commandExists('afconvert')
        ? 'darwin-say'
        : 'browser';
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  getCapabilities() {
    return {
      provider: this.provider,
      supportsServerAudio: this.provider === 'darwin-say',
      voices: Object.keys(this.voiceMap),
    };
  }

  normalizeText(text) {
    return String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, this.maxChars);
  }

  buildHash(style, text) {
    return crypto
      .createHash('sha256')
      .update(`${style}|${text}`)
      .digest('hex')
      .slice(0, 24);
  }

  resolveVoice(style) {
    return this.voiceMap[String(style || '').trim().toLowerCase()] || null;
  }

  async synthesizePage({ style, text }) {
    const voice = this.resolveVoice(style);
    if (!voice) {
      return { ok: false, code: 'VOICE_NOT_SUPPORTED', mode: 'browser' };
    }

    const normalized = this.normalizeText(text);
    if (!normalized) {
      return { ok: false, code: 'EMPTY_TEXT', mode: 'browser' };
    }

    if (this.provider !== 'darwin-say') {
      return { ok: false, code: 'SERVER_TTS_UNAVAILABLE', mode: 'browser' };
    }

    const hash = this.buildHash(style, normalized);
    const wavName = `${hash}.wav`;
    const wavPath = path.join(this.cacheDir, wavName);
    if (fs.existsSync(wavPath)) {
      return {
        ok: true,
        mode: 'audio',
        provider: this.provider,
        url: `${this.publicMount}/${wavName}`,
        cached: true,
      };
    }

    const aiffPath = path.join(this.cacheDir, `${hash}.aiff`);
    await runCommand('say', ['-v', voice, '-o', aiffPath, normalized]);
    await runCommand('afconvert', ['-f', 'WAVE', '-d', 'LEI16@22050', aiffPath, wavPath]);
    if (fs.existsSync(aiffPath)) {
      fs.unlink(aiffPath, () => {});
    }

    return {
      ok: true,
      mode: 'audio',
      provider: this.provider,
      url: `${this.publicMount}/${wavName}`,
      cached: false,
    };
  }
}

module.exports = {
  ReaderTtsService,
};
