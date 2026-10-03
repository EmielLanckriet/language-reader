"""Retain exact cue text and add explicitly grouped versions, without repairing ASR errors."""
import json, re, sys
from pathlib import Path
rows=[]
for topic, filename in zip(['tariff','cooking'], sys.argv[1:]):
    blocks=Path(filename).read_text().split('\n\n')
    cues=[]
    for block in blocks:
        lines=block.splitlines()
        at=next((i for i,s in enumerate(lines) if '-->' in s),None)
        if at is not None:
            text=re.sub('<[^>]+>','', ''.join(lines[at+1:])).strip()
            if text: cues.append(text)
    cues=cues[:20]
    for i,text in enumerate(cues): rows.append(dict(id=f'{topic}-{i:02}',kind='cue',topic=topic,text=text))
    groups=([[0,1],[2,3,4,5,6],[7,8,9,10],[11,12,13],[14],[15,16,17],[18,19]] if topic=='tariff'
            else [[0,1],[2,3],[4],[5,6,7],[8,9,10,11],[12],[13,14],[15,16],[17,18,19]])
    for i,group in enumerate(groups):
        rows.append(dict(id=f'{topic}-joined-{i:02}',kind='joined',topic=topic,
                         cue_ids=[f'{topic}-{n:02}' for n in group],text=''.join(cues[n] for n in group)+'。'))
Path(__file__).with_name('corpus.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
