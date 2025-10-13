"use client";
import * as RadixSlider from '@radix-ui/react-slider';
import { cn } from '@/lib/utils';

export interface SliderProps extends React.ComponentPropsWithoutRef<typeof RadixSlider.Root> {}

export function Slider({ className, ...props }: SliderProps) {
  return (
    <RadixSlider.Root
      className={cn('relative flex w-full touch-none select-none items-center', className)}
      {...props}
    >
      <RadixSlider.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary">
        <RadixSlider.Range className="absolute h-full bg-primary" />
      </RadixSlider.Track>
      <RadixSlider.Thumb className="block h-5 w-5 rounded-full border border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50" />
    </RadixSlider.Root>
  );
}
