import { useDebounceFn } from "ahooks";
import { useEffect, useState } from "react";

interface TapCounterButtonProps extends React.HTMLProps<HTMLButtonElement> {
  counterLimit: number;
}
export function TapCounterButton({
  counterLimit,
  onClick,
  style,
  children,
  type,
  ...props
}: TapCounterButtonProps) {
  const [counter, setCounter] = useState(counterLimit);

  const clickHandler: typeof onClick = (evt) => {
    if (counter > 1) {
      setCounter((prev) => prev - 1);
      return;
    }

    onClick?.(evt);
  };

  const { run } = useDebounceFn(
    (): void => setCounter((prev) => Math.min(counterLimit, prev + 1)),
    {
      wait: 1_000,
      trailing: true,
    },
  );

  useEffect(() => {
    if (counter >= 5) return;
    run();
  }, [counter, run]);

  return (
    <button {...props} type={type as any} onClick={clickHandler}>
      {children}
      <br />({counterLimit - counter} / {counterLimit})
    </button>
  );
}
