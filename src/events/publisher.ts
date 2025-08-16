export type UnsubscribeFunc = () => void;
export type NotifyFunc<T> = (update: T) => void

export interface Publisher<T> {
  addSubscriber(notify: NotifyFunc<T>): UnsubscribeFunc;
}

export type Subscription<T> = {
  publisher: Publisher<T>,
  unsubscribe: UnsubscribeFunc,
};
