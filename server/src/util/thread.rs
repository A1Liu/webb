use crossbeam::channel;
use tokio::sync::oneshot;

type ThreadFn<State> = Box<dyn FnOnce(&mut State) + Send + 'static>;

enum Message<State> {
    Execute(ThreadFn<State>),
    Destroy(oneshot::Sender<()>),
}

pub struct SingleThreadExecutor<State: 'static> {
    sender: channel::Sender<Message<State>>,
}

impl<State: 'static> SingleThreadExecutor<State> {
    pub fn new<F>(func: F) -> Self
    where
        F: FnOnce() -> State + Send + 'static,
    {
        let (sender, receiver) = channel::unbounded();

        tokio::task::spawn_blocking(move || {
            let mut state = func();

            while let Ok(message) = receiver.recv() {
                match message {
                    Message::Execute(func) => func(&mut state),
                    Message::Destroy(sender) => {
                        let _ = sender.send(());
                    }
                }
            }
        });

        return Self { sender };
    }

    pub async fn run<V, F>(&self, func: F) -> V
    where
        V: Send + 'static,
        F: FnOnce(&mut State) -> V + Send + 'static,
    {
        let (sender, receiver) = oneshot::channel::<V>();

        self.sender
            .send(Message::Execute(Box::new(move |state| {
                let value = func(state);

                // If send fails, that means that the caller was killed, which
                // is OK I guess.
                let _ = sender.send(value);
            })))
            .expect("TODO: Crossbeam send failed");

        return receiver.await.expect("TODO: tokio oneshot receiver failed");
    }

    pub async fn destroy(&self) -> bool {
        let (sender, receiver) = oneshot::channel();

        if let Err(_e) = self.sender.send(Message::Destroy(sender)) {
            return false;
        }

        receiver.await.expect("TODO: tokio oneshot receiver failed");
        return true;
    }
}

impl<State> Drop for SingleThreadExecutor<State> {
    fn drop(&mut self) {
        // If it fails to send, that's fine, that means it's already dead
        let _ = self.sender.send(Message::Destroy(oneshot::channel().0));
    }
}
