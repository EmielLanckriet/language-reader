"""A stand-in for yt-dlp, for Find videos' tests (spec 015): the reader service runs it through
READER_YTDLP, so neither unit tests nor browser scenarios ask YouTube anything.

Search answers four videos; their subtitles depend on the id:
  vidHuman   a human zh-CN track (and an English one, which must not be returned)
  vidAuto    only automatic Chinese, on the second pass
  vidNone    only English
  vidLimited YouTube's 429
Each call is appended to $YTDLP_STUB_LOG when set, so tests can check what was asked.
"""
import json
import os
import sys

args = sys.argv[1:]
if os.environ.get('YTDLP_STUB_LOG'):
    with open(os.environ['YTDLP_STUB_LOG'], 'a') as log:
        log.write(json.dumps(args) + '\n')

VTT = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n{}\n\n00:00:03.000 --> 00:00:05.000\n{}\n'
VIDEOS = [
    ('vidHuman', '我们一起看书', '书频道', 300),
    ('vidAuto', '你好朋友', '自动频道', 200),
    ('vidNone', 'English only', 'Other', 100),
    ('vidLimited', '太多请求', '忙频道', 150),
]

if '--flat-playlist' in args:
    for vid, title, channel, duration in VIDEOS:
        print(json.dumps({'id': vid, 'title': title, 'channel': channel, 'duration': duration,
                          'url': f'https://www.youtube.com/watch?v={vid}'}, ensure_ascii=False))
    sys.exit(0)

url = args[-1]
vid = url.rsplit('=', 1)[-1]
folder = args[args.index('-P') + 1] if '-P' in args else '.'
if vid == 'vidLimited':
    print('ERROR: Unable to download video subtitles: HTTP Error 429: Too Many Requests', file=sys.stderr)
    sys.exit(1)
automatic = '--write-auto-subs' in args
info = {'id': vid, 'subtitles': {}, 'automatic_captions': {}}
if vid == 'vidHuman' and not automatic:
    with open(os.path.join(folder, 'track.zh-CN.vtt'), 'w', encoding='utf-8') as file:
        file.write(VTT.format('我们一起看书。', '你看我，我看你。'))
    with open(os.path.join(folder, 'track.en.vtt'), 'w', encoding='utf-8') as file:
        file.write(VTT.format('We read together.', 'You look at me.'))
    info['subtitles'] = {'zh-CN': [{'name': 'Chinese (China)'}], 'en': [{'name': 'English'}]}
if vid == 'vidAuto' and automatic:
    with open(os.path.join(folder, 'track-auto.zh.vtt'), 'w', encoding='utf-8') as file:
        file.write(VTT.format('你好朋友。', '新词很多。'))
    info['automatic_captions'] = {'zh': [{'name': 'Chinese'}]}
if vid == 'vidNone' and not automatic:
    with open(os.path.join(folder, 'track.en.vtt'), 'w', encoding='utf-8') as file:
        file.write(VTT.format('Only English.', 'Nothing else.'))
    info['subtitles'] = {'en': [{'name': 'English'}]}
with open(os.path.join(folder, 'media.info.json'), 'w', encoding='utf-8') as file:
    json.dump(info, file)
