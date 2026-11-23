<script module>
  import { tv } from "tailwind-variants/lite";

  const buttonVariants = tv({
    base: "inline-flex h-10 shrink-0 items-center justify-center rounded-md px-4 text-sm font-semibold whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-4 aria-disabled:pointer-events-none aria-disabled:opacity-45 disabled:opacity-45",
    variants: {
      variant: {
        default: "bg-primary text-white hover:bg-primary/90",
        outline: "border border-line bg-white hover:border-primary",
      },
    },
    defaultVariants: { variant: "default" },
  });
</script>

<script>
  let {
    class: className,
    variant = "default",
    ref = $bindable(null),
    href = undefined,
    type = "button",
    disabled,
    children,
    ...restProps
  } = $props();
</script>

{#if href}
  <a
    bind:this={ref}
    data-slot="button"
    class={buttonVariants({ variant, class: className })}
    href={disabled ? undefined : href}
    aria-disabled={disabled}
    role={disabled ? "link" : undefined}
    tabindex={disabled ? -1 : undefined}
    {...restProps}
  >
    {@render children?.()}
  </a>
{:else}
  <button
    bind:this={ref}
    data-slot="button"
    class={buttonVariants({ variant, class: className })}
    {type}
    {disabled}
    {...restProps}
  >
    {@render children?.()}
  </button>
{/if}
