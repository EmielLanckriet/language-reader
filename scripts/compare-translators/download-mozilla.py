"""Download the exact Mozilla attachments used by this comparison, checking SHA-256."""
import hashlib, json, sys, urllib.request
from pathlib import Path
root=Path(sys.argv[1]);root.mkdir(parents=True,exist_ok=True)
records=json.loads(Path(__file__).with_name('mozilla-model.json').read_text())
server=json.load(urllib.request.urlopen('https://firefox.settings.services.mozilla.com/v1/'))
base=server['capabilities']['attachments']['base_url']
for record in records:
    item=record['attachment']
    data=urllib.request.urlopen(base+item['location'],timeout=120).read()
    assert hashlib.sha256(data).hexdigest()==item['hash'], item['filename']
    (root/item['filename']).write_bytes(data)
(root/'records.json').write_text(json.dumps(records,indent=2))
