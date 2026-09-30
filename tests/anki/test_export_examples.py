import importlib.util
import json
from pathlib import Path
import sqlite3
import tarfile
import tempfile
import unittest

MODULE = Path(__file__).resolve().parents[2] / 'scripts/anki/export_examples.py'

class ExportExamplesTest(unittest.TestCase):
    def test_read_only_export_keeps_example_and_audio(self):
        spec = importlib.util.spec_from_file_location('export_examples', MODULE)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); source = root/'collection.anki2'; media = root/'collection.media'; media.mkdir()
            db=sqlite3.connect(source)
            db.executescript('CREATE TABLE notetypes(id INTEGER,name TEXT);CREATE TABLE fields(ntid INTEGER,ord INTEGER,name TEXT);CREATE TABLE notes(id INTEGER,mid INTEGER,flds TEXT);CREATE TABLE cards(nid INTEGER,type INTEGER);')
            db.execute("INSERT INTO notetypes VALUES(1,'HSK')")
            names=['Simplified','SentenceSimplified','SentenceMeaning','SentencePinyin.1','Audio','SentenceAudio']
            db.executemany('INSERT INTO fields VALUES(1,?,?)',enumerate(names))
            db.execute('INSERT INTO notes VALUES(2,1,?)',('\x1f'.join(['学习','<b>我们学习中文。</b>','We study Chinese.','wǒ men xué xí zhōng wén','[sound:word.mp3]','[sound:sentence.mp3]']),))
            db.execute('INSERT INTO cards VALUES(2,2)');db.commit();db.close()
            (media/'word.mp3').write_bytes(b'word audio');(media/'sentence.mp3').write_bytes(b'sentence audio')
            before=source.read_bytes();output=root/'examples.tar'
            report=module.export_examples(source,output,'Test')
            self.assertEqual(source.read_bytes(),before)
            self.assertEqual(report['examples'],1)
            with tarfile.open(output) as archive:
                manifest=json.load(archive.extractfile('examples.json'))
                example=manifest['examples'][0]
                self.assertEqual(example['text'],'我们学习中文。')
                self.assertEqual(example['original']['SentenceSimplified'],'<b>我们学习中文。</b>')
                self.assertEqual(archive.extractfile('audio/'+example['wordAudio']).read(),b'word audio')
                self.assertEqual(archive.extractfile('audio/'+example['sentenceAudio']).read(),b'sentence audio')

if __name__=='__main__':unittest.main()
