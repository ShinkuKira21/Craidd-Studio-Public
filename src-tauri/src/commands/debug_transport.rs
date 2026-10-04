//! DAP pipe writes must not run on the UI thread or under session/LDI locks.
use std::io::Write;
use std::sync::mpsc::{sync_channel, SyncSender};

pub(super) struct DapWriter(SyncSender<Vec<u8>>);

impl DapWriter {
    pub(super) fn spawn(writer: impl Write + Send + 'static, on_error: impl FnOnce(String) + Send + 'static) -> Self {
        let (sender, receiver) = sync_channel::<Vec<u8>>(128);
        std::thread::spawn(move || {
            let mut writer = writer;
            while let Ok(packet) = receiver.recv() {
                if let Err(error) = writer.write_all(&packet).and_then(|_| writer.flush()) {
                    on_error(format!("Debugger transport failed: {error}"));
                    return;
                }
            }
        });
        Self(sender)
    }

    pub(super) fn send(&self, body: &str) -> Result<(), String> {
        let packet = format!("Content-Length: {}\r\n\r\n{}", body.len(), body).into_bytes();
        self.0.try_send(packet).map_err(|error| match error {
            std::sync::mpsc::TrySendError::Full(_) => "Debugger request queue is full; Stop remains available".into(),
            std::sync::mpsc::TrySendError::Disconnected(_) => "Debugger transport is closed".into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;
    use std::time::{Duration, Instant};

    struct BlockedWriter(std::sync::mpsc::Receiver<()>);
    impl Write for BlockedWriter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.recv().unwrap();
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
    }

    #[test]
    fn a_non_reading_adapter_cannot_block_control_dispatch() {
        let (release, blocked) = channel();
        let writer = DapWriter::spawn(BlockedWriter(blocked), |_| {});
        let began = Instant::now();
        let mut full = false;
        for _ in 0..130 { if writer.send("{}").is_err() { full = true; } }
        assert!(full);
        assert!(began.elapsed() < Duration::from_millis(250));
        // Release every possible packet, so the fixture worker cannot leak.
        for _ in 0..130 { let _ = release.send(()); }
        drop(writer);
    }

    #[test]
    fn queued_packets_keep_fifo_and_utf8_byte_lengths() {
        struct Recorder(std::sync::mpsc::Sender<Vec<u8>>);
        impl Write for Recorder {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.0.send(bytes.to_vec()).unwrap(); Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
        }
        let (sent, received) = channel();
        let writer = DapWriter::spawn(Recorder(sent), |_| {});
        writer.send("λ").unwrap(); writer.send("{}").unwrap();
        assert_eq!(received.recv_timeout(Duration::from_secs(1)).unwrap(), "Content-Length: 2\r\n\r\nλ".as_bytes());
        assert_eq!(received.recv_timeout(Duration::from_secs(1)).unwrap(), b"Content-Length: 2\r\n\r\n{}");
    }
}
