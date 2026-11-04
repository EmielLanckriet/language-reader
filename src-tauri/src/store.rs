//! The database file and its log (ADR-0047).
//!
//! The web app's SQLite sends one batch per finished transaction: the file's new size and the
//! chunks that changed. A batch is appended to `reader.db.log` as [length][crc32][batch] and
//! fsynced before the call returns; the log is folded into `reader.db` on open and whenever it
//! grows past `LOG_LIMIT`. A torn last record (a crash mid-append) fails its checksum and is
//! dropped, so the file always holds some finished transaction. Folding twice is harmless: every
//! write in a batch names its absolute offset.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

const MAGIC: u32 = 0x3142_4452; // "RDB1"
const LOG_LIMIT: u64 = 16 << 20;

pub struct Store {
    db: PathBuf,
    log_path: PathBuf,
    log: File,
    log_len: u64,
}

impl Store {
    pub fn open(dir: &Path) -> Result<Store, String> {
        fs::create_dir_all(dir).map_err(|e| format!("create {}: {e}", dir.display()))?;
        let db = dir.join("reader.db");
        let log_path = dir.join("reader.db.log");
        fold(&db, &log_path)?;
        let log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .map_err(|e| format!("open log: {e}"))?;
        Ok(Store { db, log_path, log, log_len: 0 })
    }

    /// The whole file, after folding the log into it.
    pub fn load(&mut self) -> Result<Vec<u8>, String> {
        self.checkpoint()?;
        match fs::read(&self.db) {
            Ok(bytes) => Ok(bytes),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(e) => Err(format!("read database: {e}")),
        }
    }

    /// Durable when this returns: the batch is in the fsynced log.
    pub fn append(&mut self, batch: &[u8]) -> Result<(), String> {
        parse(batch)?; // a malformed batch never reaches the log
        let mut record = Vec::with_capacity(batch.len() + 8);
        record.extend_from_slice(&(batch.len() as u32).to_le_bytes());
        record.extend_from_slice(&crc32(batch).to_le_bytes());
        record.extend_from_slice(batch);
        self.log.write_all(&record).map_err(|e| format!("append: {e}"))?;
        self.log.sync_data().map_err(|e| format!("sync log: {e}"))?;
        self.log_len += record.len() as u64;
        if self.log_len > LOG_LIMIT {
            self.checkpoint()?;
        }
        Ok(())
    }

    fn checkpoint(&mut self) -> Result<(), String> {
        fold(&self.db, &self.log_path)?;
        self.log_len = 0;
        Ok(())
    }
}

struct Batch<'a> {
    size: u64,
    writes: Vec<(u64, &'a [u8])>,
}

fn parse(batch: &[u8]) -> Result<Batch<'_>, String> {
    let bad = || "malformed batch".to_string();
    let u32_at = |at: usize| -> Result<u32, String> {
        Ok(u32::from_le_bytes(batch.get(at..at + 4).ok_or_else(bad)?.try_into().unwrap()))
    };
    let u64_at = |at: usize| -> Result<u64, String> {
        Ok(u64::from_le_bytes(batch.get(at..at + 8).ok_or_else(bad)?.try_into().unwrap()))
    };
    if u32_at(0)? != MAGIC {
        return Err(bad());
    }
    let size = u64_at(4)?;
    let count = u32_at(12)? as usize;
    let mut writes = Vec::with_capacity(count);
    let mut at = 16;
    for _ in 0..count {
        let offset = u64_at(at)?;
        let n = u32_at(at + 8)? as usize;
        let bytes = batch.get(at + 12..at + 12 + n).ok_or_else(bad)?;
        writes.push((offset, bytes));
        at += 12 + n;
    }
    if at != batch.len() {
        return Err(bad());
    }
    Ok(Batch { size, writes })
}

/// Apply every whole record of the log to the database file, then empty the log.
fn fold(db: &Path, log_path: &Path) -> Result<(), String> {
    let log = match fs::read(log_path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("read log: {e}")),
    };
    if log.is_empty() {
        return Ok(());
    }
    let mut file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(db)
        .map_err(|e| format!("open database: {e}"))?;
    let mut at = 0;
    while at + 8 <= log.len() {
        let n = u32::from_le_bytes(log[at..at + 4].try_into().unwrap()) as usize;
        let crc = u32::from_le_bytes(log[at + 4..at + 8].try_into().unwrap());
        let Some(batch) = log.get(at + 8..at + 8 + n) else { break };
        if crc32(batch) != crc {
            break;
        }
        let Ok(parsed) = parse(batch) else { break };
        for (offset, bytes) in parsed.writes {
            file.seek(SeekFrom::Start(offset)).map_err(|e| format!("seek: {e}"))?;
            file.write_all(bytes).map_err(|e| format!("write: {e}"))?;
        }
        file.set_len(parsed.size).map_err(|e| format!("resize: {e}"))?;
        at += 8 + n;
    }
    file.sync_all().map_err(|e| format!("sync database: {e}"))?;
    File::create(log_path)
        .and_then(|f| f.sync_all())
        .map_err(|e| format!("empty log: {e}"))?;
    Ok(())
}

/// Standard base64 with padding, as `btoa` writes it.
pub fn decode_base64(text: &str) -> Result<Vec<u8>, String> {
    fn value(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a') as u32 + 26),
            b'0'..=b'9' => Some((c - b'0') as u32 + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let bytes = text.as_bytes();
    if bytes.len() % 4 != 0 {
        return Err("base64 length".into());
    }
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    for quad in bytes.chunks(4) {
        let pad = quad.iter().rev().take_while(|&&c| c == b'=').count();
        let mut n = 0u32;
        for &c in &quad[..4 - pad] {
            n = (n << 6) | value(c).ok_or("base64 character")?;
        }
        n <<= 6 * pad as u32;
        let three = [(n >> 16) as u8, (n >> 8) as u8, n as u8];
        out.extend_from_slice(&three[..3 - pad]);
    }
    Ok(out)
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &b in bytes {
        crc ^= b as u32;
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xEDB8_8320 & (crc & 1).wrapping_neg());
        }
    }
    !crc
}

#[allow(dead_code)]
fn read_all(path: &Path) -> Vec<u8> {
    let mut out = Vec::new();
    if let Ok(mut f) = File::open(path) {
        f.read_to_end(&mut out).unwrap();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn batch(size: u64, writes: &[(u64, &[u8])]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&MAGIC.to_le_bytes());
        out.extend_from_slice(&size.to_le_bytes());
        out.extend_from_slice(&(writes.len() as u32).to_le_bytes());
        for (offset, bytes) in writes {
            out.extend_from_slice(&offset.to_le_bytes());
            out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
            out.extend_from_slice(bytes);
        }
        out
    }

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("reader-store-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn batches_survive_a_reopen_and_a_torn_tail_is_dropped() {
        let d = dir("torn");
        let mut store = Store::open(&d).unwrap();
        assert_eq!(store.load().unwrap(), Vec::<u8>::new());
        store.append(&batch(8, &[(0, b"abcdefgh")])).unwrap();
        store.append(&batch(6, &[(2, b"XY")])).unwrap(); // shrinks too
        drop(store);
        // A crash mid-append: half a record at the end of the log.
        let torn = batch(8, &[(0, b"zzzzzzzz")]);
        let mut log = OpenOptions::new().append(true).open(d.join("reader.db.log")).unwrap();
        log.write_all(&(torn.len() as u32).to_le_bytes()).unwrap();
        log.write_all(&crc32(&torn).to_le_bytes()).unwrap();
        log.write_all(&torn[..10]).unwrap();
        drop(log);

        let mut store = Store::open(&d).unwrap();
        assert_eq!(store.load().unwrap(), b"abXYef".to_vec());
        assert_eq!(read_all(&d.join("reader.db.log")), Vec::<u8>::new());
        store.append(&batch(7, &[(6, b"!")])).unwrap();
        assert_eq!(Store::open(&d).unwrap().load().unwrap(), b"abXYef!".to_vec());
    }

    #[test]
    fn a_record_of_full_length_with_corrupt_content_is_dropped() {
        let d = dir("corrupt");
        let mut store = Store::open(&d).unwrap();
        store.append(&batch(4, &[(0, b"good")])).unwrap();
        drop(store);
        let mut corrupt = batch(4, &[(0, b"evil")]);
        let crc = crc32(&corrupt);
        corrupt[28] ^= 1; // a sector that did not reach the disk whole
        let mut log = OpenOptions::new().append(true).open(d.join("reader.db.log")).unwrap();
        log.write_all(&(corrupt.len() as u32).to_le_bytes()).unwrap();
        log.write_all(&crc.to_le_bytes()).unwrap();
        log.write_all(&corrupt).unwrap();
        drop(log);
        assert_eq!(Store::open(&d).unwrap().load().unwrap(), b"good".to_vec());
    }

    #[test]
    fn base64_decodes_what_btoa_writes() {
        assert_eq!(decode_base64("").unwrap(), b"");
        assert_eq!(decode_base64("YQ==").unwrap(), b"a");
        assert_eq!(decode_base64("YWI=").unwrap(), b"ab");
        assert_eq!(decode_base64("YWJj").unwrap(), b"abc");
        assert_eq!(decode_base64("AP8Q/w==").unwrap(), vec![0, 255, 16, 255]);
        assert!(decode_base64("YQ=").is_err());
    }

    #[test]
    fn a_malformed_batch_is_refused_before_it_reaches_the_log() {
        let d = dir("malformed");
        let mut store = Store::open(&d).unwrap();
        let mut bad = batch(4, &[(0, b"abcd")]);
        bad.pop();
        assert!(store.append(&bad).is_err());
        assert_eq!(read_all(&d.join("reader.db.log")), Vec::<u8>::new());
    }
}
