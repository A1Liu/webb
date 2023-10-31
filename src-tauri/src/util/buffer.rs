use core::sync::atomic::{AtomicBool, Ordering};
use std::{
    future::Future,
    pin::Pin,
    sync::Arc,
    task::{Poll, Waker},
};
use tauri::async_runtime::Mutex;
use tokio::io::{AsyncRead, AsyncWrite};

// This is silly. I feel like SOMEONE has got to have wanted to read data from
// an in-memory buffer that's growing. Right?

// I eventually want to make this a good buffering system, but for now we can
// stick with something silly.

/*
pub struct TSBufWriter {
    buffer: Arc<TSBuffer>,
}

impl AsyncWrite for TSBufWriter {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &[u8],
    ) -> Poll<Result<usize, std::io::Error>> {
        todo!()
    }

    fn poll_flush(
        self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> Poll<Result<(), std::io::Error>> {
        todo!()
    }

    fn poll_shutdown(
        self: Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> Poll<Result<(), std::io::Error>> {
        todo!()
    }
}

pub struct TSBufReader {
    buffer: Arc<TSBuffer>,
    cursor: usize,
}

impl AsyncRead for TSBufReader {
    fn poll_read(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        if self.buffer.closed.load(Ordering::SeqCst) {
            return Poll::Ready(Ok(()));
        }

        let lock_guard = self.buffer.data.lock();
        let data = std::task::ready!(std::pin::pin!(lock_guard).poll(cx));

        let buffer = buf.initialize_unfilled();
        if self.cursor == data.len() {
            std::mem::drop(data);
            let waker = cx.waker().clone();
            self.buffer.wakers.lock().unwrap().push(waker);

            return Poll::Pending;
        }

        let end = core::cmp::min(self.cursor + buffer.len(), data.len());
        let copy_range = &data[self.cursor..end];
        buffer[..copy_range.len()].copy_from_slice(copy_range);
        let len = copy_range.len();
        std::mem::drop(data);

        self.cursor += len;
        buf.advance(len);

        return Poll::Ready(Ok(()));
    }
}

pub fn create_buffer() -> (TSBufWriter, TSBufReader) {
    let buffer = Arc::new(TSBuffer::new());
    let writer = TSBufWriter {
        buffer: buffer.clone(),
    };
    let reader = TSBufReader { buffer, cursor: 0 };

    return (writer, reader);
}

// TODO: Eventually this should probably be a linked list of append-only fixed-length buffers. For
// now though, I guess this is what we're doing.
pub struct TSBuffer {
    closed: AtomicBool,

    // TODO: Should build this kind of thing into heaparray. That library can
    // be made actually good if we switch it to using `Box` and `Arc` directly
    // https://github.com/rust-lang/rust/issues/63291
    data: Mutex<Vec<u8>>,
}

impl TSBuffer {
    pub fn new() -> Self {
        return Self {
            closed: AtomicBool::new(false),
            data: Mutex::new(Vec::new()),
        };
    }

    pub async fn append(&self, bytes: &[u8]) {
        if self.closed.load(Ordering::SeqCst) {
            panic!("OOOOOF");
        }

        if bytes.len() == 0 {
            return;
        }

        let mut data = self.data.lock().await;
        data.extend_from_slice(bytes);

        for waker in self.wakers.lock().unwrap().drain(..) {
            waker.wake();
        }
    }

    pub fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
    }
}

*/
