'use client';

import React from 'react';

const steps = ['Odabir paketa', 'Podaci', 'Plaćanje', 'Potvrda'];

interface Props {
  step: number; // current step index (0-based)
}

export default function CheckoutStepper({ step }: Props) {
  return (
    <div className="flex items-center justify-center mb-6" aria-label="Koraci naplate">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center">
          <div
            className={'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ' +
              (i <= step ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600')}
          >
            {i + 1}
          </div>
          <span className="ml-2 text-sm">{label}</span>
          {i < steps.length - 1 && <div className="w-8 h-px bg-gray-300 mx-2" />}
        </div>
      ))}
    </div>
  );
}

