import {
  useClick,
  useFloating,
  useHover,
  useInteractions,
  useDismiss,
  shift,
  offset,
} from "@floating-ui/react";
import { ComponentProps } from "react";

interface FloatingProps {
  isOpen: boolean;
  setIsOpen: (f: boolean) => void;
  allowHover?: boolean;
  allowClick?: boolean;
  floatingContent?: JSX.Element;

  wrapperProps?: Readonly<ComponentProps<"div">>;
  floatWrapperProps?: Readonly<ComponentProps<"div">>;

  children: JSX.Element;
}

export function Floating({
  isOpen,
  setIsOpen,
  allowHover = false,
  allowClick = true,
  floatingContent,
  wrapperProps = {},
  floatWrapperProps = {},
  children,
}: FloatingProps) {
  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    middleware: [
      shift({
        padding: 10,
      }),
      offset(10),
    ],
  });

  const hover = useHover(context, {
    enabled: !!floatingContent && allowHover,
  });
  const click = useClick(context, {
    enabled: !!floatingContent && allowClick,
  });
  const dismiss = useDismiss(context);

  const { getReferenceProps, getFloatingProps } = useInteractions([
    dismiss,
    click,
    hover,
  ]);

  return (
    <>
      <div ref={refs.setReference} {...getReferenceProps()} {...wrapperProps}>
        {children}
      </div>
      {isOpen && floatingContent ? (
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          {...getFloatingProps(floatWrapperProps)}
        >
          {floatingContent}
        </div>
      ) : null}
    </>
  );
}
