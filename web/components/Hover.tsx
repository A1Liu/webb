import { includeIf } from "@/util/basic";
import {
  useClick,
  useFloating,
  useHover,
  useInteractions,
  useDismiss,
} from "@floating-ui/react";
import { ComponentProps } from "react";

interface FloatingProps {
  isOpen: boolean;
  setIsOpen: (f: boolean) => void;
  allowHover?: boolean;
  allowClick?: boolean;
  floatingContent: JSX.Element;
  wrapperProps?: Readonly<ComponentProps<"div">>;
  children: JSX.Element;
}

export function Floating({
  isOpen,
  setIsOpen,
  allowHover = false,
  allowClick = true,
  wrapperProps = {},
  children,
}: FloatingProps) {
  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
  });

  const hover = useHover(context);
  const click = useClick(context);
  const dismiss = useDismiss(context);

  const { getReferenceProps, getFloatingProps } = useInteractions([
    dismiss,
    ...includeIf(allowClick, click),
    ...includeIf(allowHover, hover),
  ]);

  return (
    <>
      <div ref={refs.setReference} {...getReferenceProps()} {...wrapperProps}>
        {children}
      </div>
      {isOpen ? (
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          {...getFloatingProps()}
        >
          Floating element
        </div>
      ) : null}
    </>
  );
}
