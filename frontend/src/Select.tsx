import { useRef, useState, type JSX, type ReactNode } from "react";
import * as Primitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

const emptyValue = "__transler_empty_selection__";

type Props = {
  children: ReactNode;
  value?: string | number;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  "aria-label"?: string;
  "data-testid"?: string;
};

export function Select({
  children,
  value,
  defaultValue,
  onValueChange,
  name,
  disabled,
  required,
  "aria-label": label,
  "data-testid": testId,
}: Props): JSX.Element {
  const trigger = useRef<HTMLButtonElement>(null);
  const [container, setContainer] = useState<HTMLElement | undefined>(
    undefined,
  );
  return (
    <Primitive.Root
      value={value === undefined ? undefined : String(value) || emptyValue}
      defaultValue={
        defaultValue === undefined ? undefined : defaultValue || emptyValue
      }
      name={name}
      disabled={disabled}
      required={required}
      onValueChange={(next) => onValueChange?.(next === emptyValue ? "" : next)}
      onOpenChange={(open) => {
        if (open)
          setContainer(trigger.current?.closest("dialog") ?? document.body);
      }}
    >
      <Primitive.Trigger
        ref={trigger}
        className="select-trigger"
        aria-label={label}
        data-testid={testId}
        data-value={value === undefined ? undefined : String(value)}
      >
        <span className="select-value">
          <Primitive.Value />
        </span>
        <Primitive.Icon className="select-chevron">
          <ChevronDown size={16} />
        </Primitive.Icon>
      </Primitive.Trigger>
      <Primitive.Portal container={container}>
        <Primitive.Content
          className="select-menu"
          position="popper"
          sideOffset={6}
          collisionPadding={12}
          onEscapeKeyDown={(event) => event.stopPropagation()}
        >
          <Primitive.ScrollUpButton className="select-scroll">
            <ChevronUp size={16} />
          </Primitive.ScrollUpButton>
          <Primitive.Viewport className="select-viewport">
            {children}
          </Primitive.Viewport>
          <Primitive.ScrollDownButton className="select-scroll">
            <ChevronDown size={16} />
          </Primitive.ScrollDownButton>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}

type OptionProps = {
  value: string | number;
  children: ReactNode;
  description?: string;
};

export function SelectOption({
  value,
  children,
  description,
}: OptionProps): JSX.Element {
  return (
    <Primitive.Item
      value={String(value) || emptyValue}
      className="select-option"
      data-testid={`select-option-${value}`}
    >
      <span className="select-option-copy">
        <Primitive.ItemText>{children}</Primitive.ItemText>
        {description && <small>{description}</small>}
      </span>
      <Primitive.ItemIndicator className="select-check">
        <Check size={16} />
      </Primitive.ItemIndicator>
    </Primitive.Item>
  );
}
