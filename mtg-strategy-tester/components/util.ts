export function memoize<T>(_maker: () => T): {
  (): T;
  clear: () => void;
  memoizedValue?: T;
} {
  let maker: (() => T) | undefined = _maker;

  const func = () => {
    if (maker) {
      const result = maker();
      maker = undefined;
      func.memoizedValue = result;
      return result;
    }

    return func.memoizedValue as T;
  };

  func.memoizedValue = undefined as undefined | T;
  func.clear = () => {
    maker = _maker;
    func.memoizedValue = undefined;
  };

  return func;
}
