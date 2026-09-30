#!/usr/bin/env python3
"""Copy studied HSK examples/audio from Anki into a Reader supplementary bundle; never write Anki."""
import argparse
import hashlib
from html.parser import HTMLParser
import io
import json
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile

FIELDS = ['Simplified', 'SentenceSimplified', 'SentenceMeaning', 'SentencePinyin.1', 'Audio', 'SentenceAudio']
MIME = {'.mp3':'audio/mpeg', '.m4a':'audio/mp4', '.ogg':'audio/ogg', '.opus':'audio/ogg', '.wav':'audio/wav'}

class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True); self.parts=[]; self.skip=0
    def handle_starttag(self, tag, attrs):
        if tag in ('script','style','rt'): self.skip+=1
        elif tag=='br': self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script','style','rt'): self.skip=max(0,self.skip-1)
    def handle_data(self,data):
        if not self.skip: self.parts.append(data)

def plain(text):
    parser=PlainText();parser.feed(text)
    return re.sub(r'\[sound:[^\]]+\]', '', ''.join(parser.parts)).strip()

def export_examples(collection, output, profile):
    collection=Path(collection); output=Path(output);media=collection.parent/'collection.media'
    examples=[]; audio={}; missing=0; skipped=0
    with tempfile.TemporaryDirectory() as directory:
        source=sqlite3.connect(collection.as_uri()+'?mode=ro',uri=True)
        db=sqlite3.connect(Path(directory)/'copy.anki2')
        try: source.backup(db)
        finally: source.close()
        db.create_collation('unicase',lambda a,b:(a.casefold()>b.casefold())-(a.casefold()<b.casefold()))
        note_type=db.execute("SELECT id FROM notetypes WHERE name='HSK'").fetchone()
        if not note_type: raise ValueError('No HSK note type found.')
        fields=dict(db.execute('SELECT name,ord FROM fields WHERE ntid=?',note_type))
        if any(name not in fields for name in FIELDS): raise ValueError('HSK example fields are missing.')
        rows=db.execute('SELECT id,flds FROM notes WHERE mid=? AND EXISTS(SELECT 1 FROM cards WHERE nid=notes.id AND type!=0) ORDER BY id',note_type).fetchall()
        db.close()
    for note_id, joined in rows:
        parts=joined.split('\x1f'); original={name:parts[fields[name]] for name in FIELDS}
        word=plain(original['Simplified']);text=plain(original['SentenceSimplified'])
        if not word or word not in text: skipped+=1;continue
        item={'key':f'{profile}:{note_id}','profile':profile,'noteId':str(note_id),'word':word,'text':text,'translation':plain(original['SentenceMeaning']),'pinyin':plain(original['SentencePinyin.1']),'original':original}
        for field, key in [('Audio','wordAudio'),('SentenceAudio','sentenceAudio')]:
            names=re.findall(r'\[sound:([^\]]+)\]',original[field])
            if not names:continue
            name=names[0];path=media/name
            if Path(name).name!=name or not path.is_file() or path.suffix.lower() not in MIME: missing+=1;continue
            data=path.read_bytes()
            # Reader rejects empty clips. Keep the example, but do not give it an unusable audio reference.
            if not data: missing+=1;continue
            if len(data)>32*1024*1024:raise ValueError(f'Audio clip too large: {name}')
            digest=hashlib.sha256(data).hexdigest(); stored=digest+path.suffix.lower()
            audio[stored]={'path':path,'size':len(data),'id':digest,'mime':MIME[path.suffix.lower()]};item[key]=stored
        examples.append(item)
    manifest={'format':'reader-anki-examples','version':1,'profile':profile,'examples':examples,'audio':[{'name':name,**{k:v for k,v in info.items() if k!='path'}} for name,info in audio.items()]}
    encoded=json.dumps(manifest,ensure_ascii=False,separators=(',',':')).encode()
    if len(encoded)>32*1024*1024:raise ValueError('Example manifest too large.')
    with tarfile.open(output,'w',format=tarfile.USTAR_FORMAT) as archive:
        info=tarfile.TarInfo('examples.json');info.size=len(encoded);archive.addfile(info,io.BytesIO(encoded))
        for name,asset in audio.items():
            # A source clip changing during export must not create a mismatched content identity.
            data=asset['path'].read_bytes()
            if hashlib.sha256(data).hexdigest()!=asset['id']:raise ValueError('Anki audio changed during export; retry.')
            info=tarfile.TarInfo('audio/'+name);info.size=len(data);archive.addfile(info,io.BytesIO(data))
    return {'examples':len(examples),'audioFiles':len(audio),'missingAudio':missing,'skippedWithoutMatchingSentence':skipped,'bytes':output.stat().st_size}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile',default='User 2');parser.add_argument('--out',default='anki-examples.tar');parser.add_argument('--push',action='store_true')
    args=parser.parse_args()
    source=Path.home()/'.local/share/Anki2'/args.profile/'collection.anki2'
    print(json.dumps(export_examples(source,Path(args.out).resolve(),args.profile)))
    if args.push:
        adb=shutil.which('adb') or str(Path.home()/'Android/Sdk/platform-tools/adb')
        subprocess.run([adb,'-d','push',args.out,'/sdcard/Download/anki-examples.tar'],check=True)
        print('Reader → More → Anki examples and audio → choose anki-examples.tar')
if __name__=='__main__':main()
