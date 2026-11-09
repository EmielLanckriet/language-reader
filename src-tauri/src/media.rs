//! Media in the app's own files (ADR-0051, issue #58): video folders, card audio and Termux
//! bundles being taken, under `<app data>/library/`, where the WebView's storage eviction cannot
//! reach them. The page reads through the `readermedia` URL scheme (byte ranges, so a video is
//! never loaded whole; workers can read it too) and writes through the commands below.

use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

/// An open-ended range (`bytes=0-`, what a media element asks first) gets at most this much.
const OPEN_RANGE: u64 = 4 << 20;
/// A stated range larger than this is cut to it; the reader asks again from where it ended.
const MAX_RANGE: u64 = 64 << 20;

/// A relative path of plain names: no root, no `..`, nothing empty.
pub fn resolve(root: &Path, path: &str) -> Result<PathBuf, String> {
    let mut out = root.to_path_buf();
    if path.is_empty() {
        return Ok(out);
    }
    for part in path.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.contains('\\') || part.contains('\0')
        {
            return Err(format!("bad path {path:?}"));
        }
        out.push(part);
    }
    Ok(out)
}

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Entry {
    pub name: String,
    pub dir: bool,
    pub size: u64,
    /// Milliseconds since 1970, as `File.lastModified`.
    pub modified: u64,
}

fn entry_of(path: &Path) -> Result<Entry, String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64);
    Ok(Entry {
        name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
        dir: meta.is_dir(),
        size: if meta.is_dir() { 0 } else { meta.len() },
        modified,
    })
}

/// The folder's entries, without the `.part` files of writes in progress; None when it is missing.
pub fn list(dir: &Path) -> Result<Option<Vec<Entry>>, String> {
    let read = match fs::read_dir(dir) {
        Ok(read) => read,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let mut entries = Vec::new();
    for item in read {
        let path = item.map_err(|e| e.to_string())?.path();
        if path.extension().is_some_and(|x| x == "part") {
            continue;
        }
        // Removed between listing and reading: not there.
        if let Ok(entry) = entry_of(&path) {
            entries.push(entry);
        }
    }
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(Some(entries))
}

/// The byte range a `Range` header asks of a file `size` long: (start, end exclusive).
pub fn range_of(header: Option<&str>, size: u64) -> Result<Option<(u64, u64)>, ()> {
    let Some(header) = header else { return Ok(None) };
    let spec = header.trim().strip_prefix("bytes=").ok_or(())?;
    if spec.contains(',') {
        return Err(());
    }
    let (a, b) = spec.split_once('-').ok_or(())?;
    let (start, end) = match (a.trim(), b.trim()) {
        ("", n) => {
            let n: u64 = n.parse().map_err(|_| ())?;
            (size.saturating_sub(n), size)
        }
        (a, "") => {
            let a: u64 = a.parse().map_err(|_| ())?;
            (a, size.min(a.saturating_add(OPEN_RANGE)))
        }
        (a, b) => {
            let a: u64 = a.parse().map_err(|_| ())?;
            let b: u64 = b.parse().map_err(|_| ())?;
            if b < a {
                return Err(());
            }
            (a, size.min(b + 1))
        }
    };
    if start >= size && size > 0 {
        return Err(());
    }
    Ok(Some((start, end.min(start.saturating_add(MAX_RANGE)))))
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|x| x.to_str()).map(|x| x.to_ascii_lowercase()).as_deref() {
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("m4a") => "audio/mp4",
        Some("mp3") => "audio/mpeg",
        Some("ogg" | "opus") => "audio/ogg",
        Some("wav") => "audio/wav",
        Some("vtt") => "text/vtt",
        Some("srt") => "text/plain",
        Some("json") => "application/json",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    }
}

pub struct Reply {
    pub status: u16,
    pub headers: Vec<(&'static str, String)>,
    pub body: Vec<u8>,
}

fn reply(status: u16, body: impl Into<Vec<u8>>) -> Reply {
    Reply { status, headers: vec![("Content-Type", "text/plain".into())], body: body.into() }
}

/// `GET /file/<path>` (with or without a Range) or `GET /list/<path>`, as the scheme receives it.
pub fn serve(root: &Path, method: &str, uri_path: &str, range: Option<&str>) -> Reply {
    if method == "OPTIONS" {
        return Reply { status: 204, headers: vec![], body: vec![] };
    }
    let decoded = match percent_decode(uri_path) {
        Ok(path) => path,
        Err(e) => return reply(400, e),
    };
    let (kind, rest) = decoded.trim_start_matches('/').split_once('/').unwrap_or((&decoded, ""));
    let path = match resolve(root, rest.trim_end_matches('/')) {
        Ok(path) => path,
        Err(e) => return reply(400, e),
    };
    match kind {
        "list" => match list(&path) {
            Ok(Some(entries)) => Reply {
                status: 200,
                headers: vec![("Content-Type", "application/json".into())],
                body: serde_json::to_vec(&entries).unwrap(),
            },
            Ok(None) => reply(404, "no such folder"),
            Err(e) => reply(500, e),
        },
        "file" => match read_file(&path, range) {
            Ok(reply) => reply,
            Err(reply) => reply,
        },
        _ => reply(404, "unknown"),
    }
}

fn read_file(path: &Path, range: Option<&str>) -> Result<Reply, Reply> {
    let mut file = File::open(path).map_err(|e| {
        reply(if e.kind() == std::io::ErrorKind::NotFound { 404 } else { 500 }, e.to_string())
    })?;
    let size = file.metadata().map_err(|e| reply(500, e.to_string()))?.len();
    let mut headers = vec![
        ("Content-Type", content_type(path).to_string()),
        ("Accept-Ranges", "bytes".to_string()),
    ];
    let Some((start, end)) = range_of(range, size).map_err(|_| Reply {
        status: 416,
        headers: vec![("Content-Range", format!("bytes */{size}"))],
        body: vec![],
    })?
    else {
        let mut body = Vec::with_capacity(size as usize);
        file.read_to_end(&mut body).map_err(|e| reply(500, e.to_string()))?;
        return Ok(Reply { status: 200, headers, body });
    };
    let mut body = vec![0; (end - start) as usize];
    file.seek(SeekFrom::Start(start)).map_err(|e| reply(500, e.to_string()))?;
    file.read_exact(&mut body).map_err(|e| reply(500, e.to_string()))?;
    let last = if end == 0 { 0 } else { end - 1 };
    headers.push(("Content-Range", format!("bytes {start}-{last}/{size}")));
    Ok(Reply { status: 206, headers, body })
}

fn percent_decode(text: &str) -> Result<String, String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = text.get(i + 1..i + 3).ok_or("bad escape")?;
            out.push(u8::from_str_radix(hex, 16).map_err(|_| "bad escape")?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "not utf-8".into())
}

/// One part of a file being written: the first part starts it, the last moves it into place, so a
/// reader never sees half a file and an interrupted write leaves the previous version.
pub fn write_part(path: &Path, bytes: &[u8], first: bool, last: bool) -> Result<(), String> {
    let aside = part_path(path);
    if first {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .append(!first)
        .truncate(first)
        .open(&aside)
        .map_err(|e| format!("open {}: {e}", aside.display()))?;
    file.write_all(bytes).map_err(|e| format!("write: {e}"))?;
    if last {
        file.sync_all().map_err(|e| format!("sync: {e}"))?;
        drop(file);
        fs::rename(&aside, path).map_err(|e| format!("rename: {e}"))?;
    }
    Ok(())
}

fn part_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".part");
    path.with_file_name(name)
}

pub fn remove(path: &Path) -> Result<(), String> {
    let result = match fs::metadata(path) {
        Ok(meta) if meta.is_dir() => fs::remove_dir_all(path),
        Ok(_) => fs::remove_file(path),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => Err(e),
    };
    result.map_err(|e| e.to_string())
}

pub fn rename(from: &Path, to: &Path) -> Result<(), String> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(from, to).map_err(|e| e.to_string())
}

/// A second name for the same bytes, so taking a file from a bundle or a pending job costs no
/// space; a copy where links are refused. Replaces what `to` was.
pub fn link(from: &Path, to: &Path) -> Result<(), String> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let aside = part_path(to);
    let _ = fs::remove_file(&aside);
    if fs::hard_link(from, &aside).is_err() {
        fs::copy(from, &aside).map_err(|e| format!("copy: {e}"))?;
    }
    fs::rename(&aside, to).map_err(|e| e.to_string())
}

/// Download a Termux bundle (`http://127.0.0.1:<port>/…`, plain HTTP: the service is local) and
/// unpack its files by base name into `dir`, which is emptied first. The video goes straight to a
/// file, so it never crosses into the page.
pub fn take_bundle(url: &str, dir: &Path) -> Result<Vec<Entry>, String> {
    let rest = url.strip_prefix("http://127.0.0.1:").ok_or("only the local service")?;
    let (port, path) = rest.split_once('/').ok_or("bad address")?;
    let port: u16 = port.parse().map_err(|_| "bad port")?;
    let mut stream =
        TcpStream::connect(("127.0.0.1", port)).map_err(|e| format!("Termux unreachable: {e}"))?;
    stream.set_read_timeout(Some(Duration::from_secs(60))).ok();
    write!(stream, "GET /{path} HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\n\r\n")
        .map_err(|e| e.to_string())?;
    let mut reader = BufReader::with_capacity(1 << 20, stream);
    let mut status = String::new();
    reader.read_line(&mut status).map_err(|e| e.to_string())?;
    if status.split_whitespace().nth(1) != Some("200") {
        return Err(format!("Termux answered {}", status.trim()));
    }
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).map_err(|e| e.to_string())? == 0 || line.trim().is_empty() {
            break;
        }
    }
    let _ = fs::remove_dir_all(dir);
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let names = untar(&mut reader, dir)?;
    names.iter().map(|name| entry_of(&dir.join(name))).collect()
}

fn field(header: &[u8]) -> String {
    let end = header.iter().position(|&b| b == 0).unwrap_or(header.len());
    String::from_utf8_lossy(&header[..end]).into_owned()
}

/// The regular files of an uncompressed tar, as `media/tar.ts` reads them (GNU long names; pax
/// headers skipped), written by base name. Returns the names written.
pub fn untar(input: &mut impl Read, dir: &Path) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    let mut long_name: Option<String> = None;
    let mut header = [0u8; 512];
    loop {
        match input.read_exact(&mut header) {
            Ok(()) => {}
            // A download cut between members: Termux's tars always end with zero blocks.
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                return Err("the bundle ended early".into())
            }
            Err(e) => return Err(e.to_string()),
        }
        if header.iter().all(|&b| b == 0) {
            break;
        }
        let size = u64::from_str_radix(field(&header[124..136]).trim(), 8).unwrap_or(0);
        let padded = size.div_ceil(512) * 512;
        let kind = header[156];
        let name = long_name.take().unwrap_or_else(|| {
            let prefix = field(&header[345..500]);
            let name = field(&header[0..100]);
            if prefix.is_empty() { name } else { format!("{prefix}/{name}") }
        });
        let mut body = input.by_ref().take(padded);
        match kind {
            b'L' => {
                let mut bytes = Vec::new();
                body.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
                bytes.truncate(size as usize);
                long_name = Some(field(&bytes));
            }
            b'0' | 0 => {
                let base = name.rsplit('/').next().unwrap_or_default().to_string();
                let target = resolve(dir, &base)?;
                let aside = part_path(&target);
                let mut file = File::create(&aside).map_err(|e| e.to_string())?;
                let copied = std::io::copy(&mut body.by_ref().take(size), &mut file)
                    .map_err(|e| format!("reading the bundle: {e}"))?;
                if copied != size {
                    return Err("the bundle ended early".into());
                }
                std::io::copy(&mut body, &mut std::io::sink()).map_err(|e| e.to_string())?;
                file.sync_all().map_err(|e| e.to_string())?;
                fs::rename(&aside, &target).map_err(|e| e.to_string())?;
                if !names.contains(&base) {
                    names.push(base);
                }
            }
            _ => {
                std::io::copy(&mut body, &mut std::io::sink()).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(names)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("reader-media-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn member(out: &mut Vec<u8>, name: &str, kind: u8, body: &[u8]) {
        let mut header = [0u8; 512];
        header[..name.len()].copy_from_slice(name.as_bytes());
        let size = format!("{:011o}\0", body.len());
        header[124..136].copy_from_slice(size.as_bytes());
        header[156] = kind;
        out.extend_from_slice(&header);
        out.extend_from_slice(body);
        out.resize(out.len().div_ceil(512) * 512, 0);
    }

    #[test]
    fn paths_stay_inside_the_root() {
        let root = Path::new("/r");
        assert_eq!(resolve(root, "media/12/meta.json").unwrap(), Path::new("/r/media/12/meta.json"));
        assert_eq!(resolve(root, "").unwrap(), Path::new("/r"));
        for bad in ["../x", "media/../../x", "/abs", "a//b", "a/./b", "a\\b"] {
            assert!(resolve(root, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn ranges() {
        assert_eq!(range_of(None, 10), Ok(None));
        assert_eq!(range_of(Some("bytes=2-5"), 10), Ok(Some((2, 6))));
        assert_eq!(range_of(Some("bytes=2-"), 10), Ok(Some((2, 10))));
        assert_eq!(range_of(Some("bytes=-3"), 10), Ok(Some((7, 10))));
        assert_eq!(range_of(Some("bytes=8-100"), 10), Ok(Some((8, 10))));
        assert_eq!(range_of(Some("bytes=0-"), 100 << 20), Ok(Some((0, OPEN_RANGE))));
        assert_eq!(range_of(Some("bytes=0-"), 0), Ok(Some((0, 0))));
        assert!(range_of(Some("bytes=10-"), 10).is_err());
        assert!(range_of(Some("bytes=5-2"), 10).is_err());
        assert!(range_of(Some("bytes=0-1,4-5"), 10).is_err());
    }

    #[test]
    fn a_range_is_served_as_206_and_a_listing_hides_parts() {
        let d = dir("serve");
        write_part(&d.join("a/b c.mp4"), b"0123", true, false).unwrap();
        assert_eq!(serve(&d, "GET", "/list/a", None).body, b"[]");
        write_part(&d.join("a/b c.mp4"), b"456789", false, true).unwrap();
        let r = serve(&d, "GET", "/file/a/b%20c.mp4", Some("bytes=3-5"));
        assert_eq!((r.status, r.body.as_slice()), (206, b"345".as_slice()));
        assert!(r.headers.contains(&("Content-Range", "bytes 3-5/10".into())));
        let whole = serve(&d, "GET", "/file/a/b%20c.mp4", None);
        assert_eq!((whole.status, whole.body.as_slice()), (200, b"0123456789".as_slice()));
        let listed: serde_json::Value =
            serde_json::from_slice(&serve(&d, "GET", "/list/a/", None).body).unwrap();
        assert_eq!(listed[0]["name"], "b c.mp4");
        assert_eq!(listed[0]["size"], 10);
        assert_eq!(serve(&d, "GET", "/list/missing", None).status, 404);
        assert_eq!(serve(&d, "GET", "/file/a/none", None).status, 404);
        assert_eq!(serve(&d, "GET", "/file/../x", None).status, 400);
    }

    #[test]
    fn a_link_replaces_the_target_and_keeps_the_source() {
        let d = dir("link");
        write_part(&d.join("s/v.mp4"), b"video", true, true).unwrap();
        write_part(&d.join("t/v.mp4"), b"old", true, true).unwrap();
        link(&d.join("s/v.mp4"), &d.join("t/v.mp4")).unwrap();
        assert_eq!(fs::read(d.join("t/v.mp4")).unwrap(), b"video");
        remove(&d.join("s")).unwrap();
        assert_eq!(fs::read(d.join("t/v.mp4")).unwrap(), b"video");
        remove(&d.join("s")).unwrap(); // already gone
    }

    #[test]
    fn a_bundle_unpacks_by_base_name() {
        let d = dir("untar");
        let mut tar = Vec::new();
        member(&mut tar, "./meta.json", b'0', b"{}");
        member(&mut tar, "././@PaxHeader", b'x', b"20 path=whatever\n");
        let long = format!("./{}.vtt", "x".repeat(120));
        member(&mut tar, "././@LongLink", b'L', format!("{long}\0").as_bytes());
        member(&mut tar, "ignored", b'0', b"WEBVTT");
        member(&mut tar, "./media.mp4", b'0', &vec![7u8; 1300]);
        tar.extend_from_slice(&[0u8; 1024]);
        let names = untar(&mut tar.as_slice(), &d).unwrap();
        assert_eq!(names, vec!["meta.json".to_string(), format!("{}.vtt", "x".repeat(120)), "media.mp4".into()]);
        assert_eq!(fs::read(d.join("media.mp4")).unwrap(), vec![7u8; 1300]);
        assert_eq!(fs::read(d.join(&names[1])).unwrap(), b"WEBVTT");
    }

    #[test]
    fn a_cut_bundle_fails() {
        let d = dir("cut");
        let mut tar = Vec::new();
        member(&mut tar, "./media.mp4", b'0', &vec![7u8; 1300]);
        let whole = tar.clone();
        tar.truncate(900);
        assert!(untar(&mut tar.as_slice(), &d).is_err());
        assert!(!d.join("media.mp4").exists());
        // Cut after a whole member, before the end blocks.
        assert!(untar(&mut whole.as_slice(), &d).is_err());
    }
}
