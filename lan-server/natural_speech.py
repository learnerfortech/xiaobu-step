"""Xiaoyi audio worker. Reads selected speech text from stdin; emits only MP3 bytes."""
import asyncio
import sys
from urllib.request import getproxies
import edge_tts

async def main():
    text = sys.stdin.read()
    if not text.strip() or len(text) > 5000:
        raise ValueError('invalid_speech_text')
    proxies = getproxies()
    proxy = proxies.get('https') or proxies.get('http')
    speech = edge_tts.Communicate(text, 'zh-CN-XiaoyiNeural', rate='-5%',
                                  proxy=proxy, connect_timeout=5, receive_timeout=10)
    data = bytearray()
    async for chunk in speech.stream():
        if chunk['type'] == 'audio':
            data.extend(chunk['data'])
    if len(data) < 100:
        raise ValueError('empty_speech')
    sys.stdout.buffer.write(data)

if __name__ == '__main__':
    asyncio.run(main())
