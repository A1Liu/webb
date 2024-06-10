import clsx from "clsx";
import { useDebounceFn } from "ahooks";
import React, { useEffect, useState } from "react";
import { forwardRef } from "react";

type BtnColor = "primary" | "secondary" | "text";
type BtnSize = "caption" | "xs" | "sm" | "md";
type BaseBtnProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

interface ButtonProps extends Omit<BaseBtnProps, ""> {
  color?: BtnColor;
  size?: BtnSize;
}

const ColorConfig: Record<BtnColor, string> = {
  primary: clsx(
    "bg-amber-700 hover:bg-amber-900 text-gray-300",
    "disabled:bg-stone-800 disabled:text-gray-400",
  ),
  secondary: clsx("bg-gray-800 text-amber-700"),
  text: clsx("bg-none hover:bg-stone-700 text-amber-700"),
};

const SizeConfig: Record<BtnSize, string> = {
  caption: clsx("px-1 py-0.5 text-xs font-bold"),
  xs: clsx("px-2 py-1 text-xs font-bold"),
  sm: clsx("px-3 py-2 text-sm font-bold"),
  md: clsx(""),
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { type = "button", color = "primary", size = "sm", className, ...props },
    ref,
  ) {
    const colorClass = ColorConfig[color];
    const sizeClass = SizeConfig[size];

    return (
      <button
        ref={ref}
        type={type}
        className={clsx(
          // Flex config?
          "rounded flex flex-row items-center justify-center",
          colorClass,
          sizeClass,
          className,
        )}
        {...props}
      />
    );
  },
);

interface TapCounterBtnProps extends ButtonProps {
  counterLimit: number;
}

export const TapCounterButton = forwardRef<
  HTMLButtonElement,
  TapCounterBtnProps
>(function TapCounterButton(
  { counterLimit, onClick, children, ...props },
  ref,
) {
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
    <Button ref={ref} onClick={clickHandler} {...props}>
      {children} ({counterLimit - counter} / {counterLimit})
    </Button>
  );
});
