"""Bounded, in-memory, local speech. Only caller-selected existing task text is spoken."""
from collections import OrderedDict
from pathlib import Path
import hashlib
import re
import subprocess
import threading
import time
import os

PHONICS_NAMES = {'b':'玻','p':'坡','m':'摸','f':'佛','d':'得','t':'特','n':'讷','l':'勒'}
SINGLE_INITIAL = re.compile(r'(?<![A-Za-z])([bpmfdtnl])(?![A-Za-z])', re.I)

def task_speech_text(task):
    title = str(task.get('title') or '').strip()
    text = '。'.join(str(v).strip() for v in (title,task.get('child_demo') or task.get('first_step','')) if str(v).strip())
    if re.search(r'拼音|声母', title):
        text = re.sub(r'(?<![A-Za-z])dtnl(?![A-Za-z])', '得、特、讷、勒', text, flags=re.I)
        text = re.sub(r'(?<![A-Za-z])bpmf(?![A-Za-z])', '玻、坡、摸、佛', text, flags=re.I)
        text = SINGLE_INITIAL.sub(lambda m: PHONICS_NAMES[m.group(1).lower()], text)
    return text

class LocalSpeech:
    def __init__(self, executable=None, cache_dir=None, natural_python=None, natural_enabled=False):
        self.natural_enabled = natural_enabled
        self.executable = Path(executable or Path(__file__).with_name('local-speech'))
        self.natural_python = Path(natural_python or Path(__file__).parent / '.speech-venv/bin/python')
        self.worker = Path(__file__).with_name('natural_speech.py')
        self.cache_dir = Path(cache_dir) if cache_dir else None
        self.cache = OrderedDict()
        self.lock = threading.Lock()
        self.retry_natural_after = 0

    @staticmethod
    def valid_mp3(data):
        return len(data) > 100 and (data[:3] == b'ID3' or (data[0] == 255 and data[1] & 224 == 224))

    def render(self, task):
        text = task_speech_text(task)
        if not text or len(text) > 5000:
            raise ValueError('invalid_speech_text')
        key = hashlib.sha256(('xiaoyi-v1-rate-5:' + text).encode()).hexdigest()
        path = self.cache_dir / (key + '.mp3') if self.cache_dir else None
        if not self.lock.acquire(timeout=35):
            raise OSError('speech_busy')
        try:
            if path and path.is_file():
                data = path.read_bytes()
                if self.valid_mp3(data):
                    return data
            if self.natural_enabled and self.natural_python.is_file() and time.monotonic() >= self.retry_natural_after:
                try:
                    result = subprocess.run([str(self.natural_python), str(self.worker)],
                        input=text.encode(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                        timeout=18, check=True)
                    data = result.stdout
                    if not self.valid_mp3(data):
                        raise OSError('invalid_natural_audio')
                    if path:
                        self.cache_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
                        temp = path.with_suffix('.tmp')
                        temp.write_bytes(data)
                        os.replace(temp, path)
                        files = sorted(self.cache_dir.glob('*.mp3'), key=lambda p: p.stat().st_mtime)
                        size = sum(p.stat().st_size for p in files)
                        while len(files) > 128 or size > 64 * 1024 * 1024:
                            old = files.pop(0); size -= old.stat().st_size; old.unlink()
                    return data
                except (OSError, subprocess.SubprocessError):
                    self.retry_natural_after = time.monotonic() + 60
            # Natural audio unavailable: keep the existing on-device voice, never drop the text.
            if key in self.cache:
                self.cache.move_to_end(key)
                return self.cache[key]
            result = subprocess.run([str(self.executable)], input=text.encode(),
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=35, check=True)
            data = result.stdout
            if len(data) < 44 or data[:4] != b'RIFF' or data[8:12] != b'WAVE':
                raise OSError('speech_unavailable')
            self.cache[key] = data
            while len(self.cache) > 16 or sum(map(len, self.cache.values())) > 32 * 1024 * 1024:
                self.cache.popitem(last=False)
            return data
        finally:
            self.lock.release()
